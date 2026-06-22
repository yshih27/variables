/**
 * Collector Crypt GACHA warmer — the native winners feed, replacing the
 * Dune-only platform-grain view with PER-PACK realized data.
 *
 * Sources (both unauthenticated, see src/lib/cc/gacha.ts):
 *   • /api/gachas/all      — machine catalog: stated odds/EV/buyback per pack.
 *   • /api/getAllWinners   — realized pulls with prize NFT + insuredValue,
 *                            `?perTier=N` = most-recent-N per (machine × tier).
 *
 * ⚠️ STRATIFIED SAMPLE. perTier serves equal-depth slices per tier, so commons
 * (75–80% of real pulls) and epics (1%) arrive in equal counts. Aggregating
 * naively would wildly overstate EV. The honest fix used here: per pack, find
 * the COMPLETE-coverage window — a tier's slice is truncated only when it hit
 * the perTier cap, so coverage is complete from max(oldest-of-truncated-tiers)
 * to now — and compute EV/median/odds ONLY inside that window, where the data
 * is a complete census, not a sample. Hot packs get short windows (small n,
 * flagged thin downstream); slow packs get weeks.
 *
 * Also ingests every pull into the durable gacha_pulls spine (idempotent), same
 * accumulate pattern as the Phygitals warmer. One known loss: a pack×tier doing
 * >perTier pulls between runs overflows the slice (commons on the hottest packs
 * at 6h cadence) — fine for the spine's role (top-hits / long-window checks);
 * the snapshot's realized stats never rely on spine completeness.
 */
import {
  fetchCCGachaCatalog,
  fetchCCWinners,
  ccGachaPackImage,
  CC_TIER_ORDER,
  type CCGachaMachine,
  type CCTierKey,
  type CCWinner,
} from "../../cc/gacha";
import {
  readCCGacha,
  writeCCGacha,
  type CCGachaPack,
  type CCGachaSnapshot,
  type CCOddsBand,
  type CCRealized,
} from "../ccGachaCache";
import { readGachaDune, type GachaBigHit } from "../gachaDuneCache";
import { PHYGITALS_VALUE_BANDS } from "../phygitalsGachaCache";
import { recordFreshness } from "../../db/freshness";
import { db } from "../../db/client";

const DEFAULT_PER_TIER = 100;
const MAX_BIG_HITS = 15;
const BIG_HITS_WINDOW_DAYS = 7;
// CC rotates machines off the menu without flagging them archived in the
// catalog (firegrass_100 and water_100 are byte-identical). The only signal is
// pull recency: a LIVE public machine pulls every few minutes; an archived one
// is days/weeks stale (observed: live <1h, firegrass 12d, gachopia 33d). Drop
// public machines with no pull in this window — the gap is huge, so the exact
// threshold barely matters.
const LIVE_WINDOW_HOURS = 72;

const TIER_LABEL: Record<CCTierKey, string> = {
  epic: "Epic",
  rare: "Rare",
  uncommon: "Uncommon",
  common: "Common",
};

function catKey(menuCategory: string | null | undefined): string | null {
  const c = (menuCategory ?? "").trim().toLowerCase();
  if (c === "pokemon") return "pokemon";
  if (c === "one piece") return "one_piece";
  if (c === "sports") return "sports";
  if (c === "pop") return "pop";
  return null;
}

/** Machine price — catalog amount, else the code's `_N` suffix (water_100 → 100). */
function priceOf(m: { code: string; price?: { amount: number } }): number {
  const amt = m.price?.amount;
  if (amt && amt > 0) return amt;
  const suffix = m.code.match(/_(\d+)$/);
  return suffix ? Number(suffix[1]) : 0;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function statedBands(m: CCGachaMachine): CCOddsBand[] {
  return CC_TIER_ORDER.map((tier) => ({
    tier,
    pct: m.weightMultipliers?.[tier] ?? 0,
    minUsd: m.tierRanges?.[tier]?.start ?? null,
    maxUsd: m.tierRanges?.[tier]?.end ?? null,
  }));
}

/**
 * Realized stats for one pack from this run's stratified sample.
 * `perTier` is the cap the sample was fetched with — a tier slice is truncated
 * (and thus constrains the complete window) only when it hit that cap.
 */
const MAX_EXAMPLES = 40;

function realizedFor(
  pack: { code: string; priceUsd: number },
  rows: CCWinner[],
  perTier: number,
  nowMs: number,
  prevTop: CCRealized["topHit"],
): CCRealized | null {
  // All-time top hit is valid regardless of stratification — max over everything
  // seen, merged with the previous snapshot's so it survives across runs.
  let topHit = prevTop ?? null;
  for (const r of rows) {
    if (r.valueUsd > (topHit?.valueUsd ?? 0)) {
      topHit = { mint: r.mint, name: r.name, image: r.image, valueUsd: r.valueUsd, at: r.at };
    }
  }
  // Top pulled cards with art — the machine's de-facto showcase (CC publishes
  // no pool). Sampling is stratified, but "best things it has paid" is exactly
  // what a value-ranked cut of the sample gives. Deduped by mint: a card can be
  // re-won after a buyback, but it's still ONE example.
  const seenMints = new Set<string>();
  const examples: NonNullable<CCRealized["examples"]> = [];
  for (const r of [...rows].filter((x) => x.valueUsd > 0).sort((a, b) => b.valueUsd - a.valueUsd)) {
    if (seenMints.has(r.mint)) continue;
    seenMints.add(r.mint);
    examples.push({ mint: r.mint, name: r.name, image: r.image, valueUsd: r.valueUsd, at: r.at });
    if (examples.length >= MAX_EXAMPLES) break;
  }
  if (rows.length === 0) {
    return topHit ? emptyRealized(topHit) : null;
  }

  // Complete-coverage window: starts at the oldest record of the most-truncated
  // tier. Tiers under the cap are complete back to the machine's first pull and
  // don't constrain it.
  const byTier = new Map<CCTierKey, number[]>();
  for (const r of rows) {
    if (!r.tier) continue;
    const t = Date.parse(r.at);
    if (!Number.isFinite(t)) continue;
    const arr = byTier.get(r.tier);
    if (arr) arr.push(t);
    else byTier.set(r.tier, [t]);
  }
  let windowStart = -Infinity;
  for (const [, times] of byTier) {
    if (times.length >= perTier) windowStart = Math.max(windowStart, Math.min(...times));
  }

  const win = rows.filter((r) => {
    const t = Date.parse(r.at);
    return Number.isFinite(t) && t >= windowStart && r.valueUsd > 0 && r.tier != null;
  });
  if (win.length === 0) return topHit ? emptyRealized(topHit) : null;

  const mults = win.map((r) => r.valueUsd / pack.priceUsd);
  // Canonical value-band distribution (same bands as Phygitals) so CC packs
  // can sit row-aligned next to other platforms in odds-breakdown comparisons.
  const bandCounts = PHYGITALS_VALUE_BANDS.map(() => 0);
  for (const m of mults) {
    const i = PHYGITALS_VALUE_BANDS.findIndex((b) => m >= b.minMult && m < b.maxMult);
    if (i >= 0) bandCounts[i]++;
  }
  const valueBands = PHYGITALS_VALUE_BANDS.map((b, i) => ({
    label: b.label,
    pct: mults.length > 0 ? bandCounts[i] / mults.length : 0,
    hit: b.hit,
  }));
  const tierCounts = new Map<CCTierKey, number>();
  for (const r of win) tierCounts.set(r.tier as CCTierKey, (tierCounts.get(r.tier as CCTierKey) ?? 0) + 1);
  const odds = CC_TIER_ORDER.map((tier) => ({
    tier,
    pct: (tierCounts.get(tier) ?? 0) / win.length,
  }));

  const fromMs = windowStart === -Infinity ? Math.min(...win.map((r) => Date.parse(r.at))) : windowStart;
  const windowHours = (nowMs - fromMs) / 3_600_000;
  const dayAgo = nowMs - 86_400_000;
  const exact24h = windowHours >= 24;
  const in24h = win.filter((r) => Date.parse(r.at) >= dayAgo).length;
  // Sub-24h windows get a naive rate extrapolation here — it's burst-biased on
  // hot machines (a 20-minute window × 24 overweights peak activity), so
  // apportionPulls24h re-anchors these against Dune's exact per-price totals
  // afterwards whenever that snapshot is available.
  const pulls24h = exact24h
    ? in24h
    : windowHours > 0
      ? Math.round((win.length / windowHours) * 24)
      : null;

  return {
    n: win.length,
    windowHours,
    fromISO: new Date(fromMs).toISOString(),
    evMultiple: mults.reduce((s, x) => s + x, 0) / mults.length,
    medianReturn: median(mults),
    odds,
    hitOdds: odds.filter((o) => o.tier !== "common").reduce((s, o) => s + o.pct, 0),
    valueBands,
    pulls24h,
    pulls24hEstimated: !exact24h,
    topHit,
    examples,
  };
}

function emptyRealized(topHit: NonNullable<CCRealized["topHit"]>): CCRealized {
  return {
    n: 0,
    windowHours: null,
    fromISO: null,
    evMultiple: null,
    medianReturn: null,
    odds: null,
    hitOdds: null,
    valueBands: null,
    pulls24h: null,
    pulls24hEstimated: false,
    topHit,
    examples: [],
  };
}

/**
 * Re-anchor sub-24h pulls24h estimates against Dune's EXACT per-price 24h pull
 * counts (full on-chain scan). The winners sample gives each machine's relative
 * intensity (n / windowHours over its complete window); Dune gives the true
 * total per price tier. Apportioning the tier total by relative rate kills the
 * burst bias a naive ×24 extrapolation has on hot machines. PRIVATE machines
 * are included in the rate pool — they pull at the same prices, so leaving them
 * out would inflate every public machine's share. Machines whose own window
 * already covers 24h keep their exact count (subtracted from the pool first).
 */
function apportionPulls24h(
  machines: { code: string; priceUsd: number }[],
  realizedByCode: Map<string, CCRealized | null>,
  dunePulls24hByPrice: Map<number, number>,
): void {
  const byPrice = new Map<number, { code: string }[]>();
  for (const m of machines) {
    const arr = byPrice.get(m.priceUsd);
    if (arr) arr.push(m);
    else byPrice.set(m.priceUsd, [m]);
  }
  for (const [price, group] of byPrice) {
    const total = dunePulls24hByPrice.get(price);
    if (total == null) continue; // no anchor — the naive estimate stands
    const estimated: { r: CCRealized; rate: number }[] = [];
    let exactSum = 0;
    for (const m of group) {
      const r = realizedByCode.get(m.code);
      if (!r || r.pulls24h == null) continue;
      if (!r.pulls24hEstimated) exactSum += r.pulls24h;
      else if (r.windowHours != null && r.windowHours > 0 && r.n > 0)
        estimated.push({ r, rate: r.n / r.windowHours });
    }
    const rateSum = estimated.reduce((s, e) => s + e.rate, 0);
    if (estimated.length === 0 || rateSum <= 0) continue;
    const remaining = Math.max(0, total - exactSum);
    for (const e of estimated) e.r.pulls24h = Math.round((remaining * e.rate) / rateSum);
  }
}

/** Windowed top hits for the coverflow — union with prev, dedupe by mint, 7d cutoff. */
function mergeBigHits(prev: GachaBigHit[], fresh: GachaBigHit[], sinceMs: number): GachaBigHit[] {
  const byMint = new Map<string, GachaBigHit>();
  for (const h of [...prev, ...fresh]) {
    if (!h.mint || !(h.valueUsd > 0)) continue;
    const at = Date.parse(h.at);
    if (Number.isFinite(at) && at < sinceMs) continue;
    const cur = byMint.get(h.mint);
    // Higher value wins; on ties prefer the entry that knows its pack (fresh
    // scans carry it, pre-upgrade snapshot entries don't).
    if (!cur || h.valueUsd > cur.valueUsd || (h.valueUsd === cur.valueUsd && h.pack && !cur.pack))
      byMint.set(h.mint, h);
  }
  return [...byMint.values()].sort((a, b) => b.valueUsd - a.valueUsd).slice(0, MAX_BIG_HITS);
}

/** Ingest pulls into the durable spine (idempotent by pull_id). Shared by the
 *  6h warmer and the real-time listener (scripts/listen-gacha.ts). */
export async function ingestCCPulls(winners: CCWinner[], priceByCode: Map<string, number>): Promise<void> {
  const rows = winners.map((w) => ({
    // created_at is stable per pull; mint alone could repeat if a bought-back
    // card is re-won later, so the timestamp rides in the id.
    pull_id: `collector-crypt:${w.mint}:${Date.parse(w.at)}`,
    platform_id: "collector-crypt",
    product_id: `collector-crypt:${w.packCode}`,
    buyer: w.wallet || null,
    price_usd: priceByCode.get(w.packCode) ?? null,
    prize_instance_id: `cc-${w.mint}`,
    prize_value_usd: w.valueUsd > 0 ? w.valueUsd : null,
    tx_hash: null,
    source: "cc-gacha-api",
    pulled_at: w.at,
  }));
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db().from("gacha_pulls").upsert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`gacha_pulls: ${error.message}`);
  }
}

export type CCGachaWarmResult = {
  machines: number;
  publicPacks: number;
  sampledPulls: number;
  bigHits: number;
  topHitUsd: number;
  generatedAt: string;
};

export async function runCCGachaWarm(
  opts: { perTier?: number; log?: (m: string) => void } = {},
): Promise<CCGachaWarmResult> {
  const log = opts.log ?? (() => {});
  const startedAt = Date.now();
  const perTier = opts.perTier ?? DEFAULT_PER_TIER;

  // 1. Catalog (stated side) + winners sample (realized side).
  const catalog = await fetchCCGachaCatalog();
  const winners = await fetchCCWinners(perTier);
  log(`catalog: ${catalog.length} machines · winners sample: ${winners.length} pulls (perTier=${perTier})`);

  // 2. Spine ingest — every pull, private machines included (data is data).
  const priceByCode = new Map(catalog.map((m) => [m.code, priceOf(m)]));
  await ingestCCPulls(winners, priceByCode);

  // 3. Realized stats for EVERY machine — private ones too, so the Dune
  //    apportionment below splits each price tier across its true pull pool.
  const prev = await readCCGacha();
  const prevTopByCode = new Map(
    (prev?.packs ?? []).map((p) => [p.code, p.realized?.topHit ?? null]),
  );
  const byCode = new Map<string, CCWinner[]>();
  const lastPullByCode = new Map<string, number>(); // max created_at per machine
  for (const w of winners) {
    const arr = byCode.get(w.packCode);
    if (arr) arr.push(w);
    else byCode.set(w.packCode, [w]);
    const t = Date.parse(w.at);
    if (Number.isFinite(t) && t > (lastPullByCode.get(w.packCode) ?? 0)) lastPullByCode.set(w.packCode, t);
  }
  const liveCutoff = startedAt - LIVE_WINDOW_HOURS * 3_600_000;
  const realizedByCode = new Map<string, ReturnType<typeof realizedFor>>();
  for (const m of catalog) {
    realizedByCode.set(
      m.code,
      realizedFor(
        { code: m.code, priceUsd: priceOf(m) },
        byCode.get(m.code) ?? [],
        perTier,
        startedAt,
        prevTopByCode.get(m.code) ?? null,
      ),
    );
  }

  // Re-anchor sub-24h popularity estimates on Dune's exact per-price totals.
  try {
    const dune = await readGachaDune();
    const byPrice = new Map(
      (dune?.platforms?.["collector-crypt"]?.byPrice ?? []).map((b) => [
        Math.round(b.price),
        b.pulls24h,
      ]),
    );
    if (byPrice.size > 0) {
      apportionPulls24h(
        catalog.map((m) => ({ code: m.code, priceUsd: priceOf(m) })),
        realizedByCode,
        byPrice,
      );
      log(`pulls24h re-anchored on Dune price-tier totals (${byPrice.size} tiers)`);
    }
  } catch {
    log("Dune snapshot unavailable — pulls24h stays a raw rate estimate");
  }

  // 4. Per-pack snapshot rows — public machines that are STILL LIVE (pulled
  //    within the recency window). Archived-but-public machines (firegrass,
  //    gachopia) are dropped; the catalog can't tell them apart, only recency.
  let droppedArchived = 0;
  const packs: CCGachaPack[] = catalog
    .filter((m) => {
      if (!m.public) return false;
      const last = lastPullByCode.get(m.code);
      const live = last != null && last >= liveCutoff;
      if (!live) droppedArchived++;
      return live;
    })
    .map((m) => {
      const priceUsd = priceOf(m);
      const realized = realizedByCode.get(m.code) ?? null;
      const last = lastPullByCode.get(m.code);
      return {
        code: m.code,
        name: m.shortName || m.name,
        fullName: m.name,
        category: catKey(m.menuCategory),
        priceUsd,
        image: ccGachaPackImage(m.code),
        packType: m.code.startsWith("sealed") ? ("sealed" as const) : ("graded-single" as const),
        turbo: m.turboMode ?? false,
        lastPullAt: last != null ? new Date(last).toISOString() : null,
        oddsStated: statedBands(m),
        hitOddsStated: m.bigWinChance != null ? m.bigWinChance / 100 : null,
        evStatedMultiple: priceUsd > 0 && m.targetEV > 0 ? m.targetEV / priceUsd : null,
        maxEvMultiple: priceUsd > 0 && m.maxEV > 0 ? m.maxEV / priceUsd : null,
        buybackPct:
          m.instantBuyback?.percentageOfValue != null
            ? m.instantBuyback.percentageOfValue / 100
            : null,
        realized,
      };
    })
    .sort((a, b) => a.priceUsd - b.priceUsd || a.code.localeCompare(b.code));

  // 5. Coverflow hits — across ALL machines (a private-machine hit still happened).
  const sinceMs = startedAt - BIG_HITS_WINDOW_DAYS * 86_400_000;
  const nameByCode = new Map(catalog.map((m) => [m.code, m.shortName || m.name]));
  const fresh: GachaBigHit[] = winners
    .filter((w) => w.valueUsd > 0)
    .map((w) => ({
      platform: "collector-crypt",
      mint: w.mint,
      name: w.name ?? w.mint.slice(0, 8),
      tier: w.tier ? TIER_LABEL[w.tier] : "",
      valueUsd: w.valueUsd,
      image: w.image,
      imageFallback: null,
      at: w.at,
      pack: nameByCode.get(w.packCode) ?? w.packCode,
    }));
  const bigHits = mergeBigHits(prev?.bigHits ?? [], fresh, sinceMs);

  const times = winners.map((w) => Date.parse(w.at)).filter(Number.isFinite);
  const generatedAt = new Date().toISOString();
  const snap: CCGachaSnapshot = {
    generatedAt,
    sample: {
      pulls: winners.length,
      perTier,
      fromISO: times.length ? new Date(Math.min(...times)).toISOString() : null,
      toISO: times.length ? new Date(Math.max(...times)).toISOString() : null,
    },
    packs,
    bigHits,
  };
  await writeCCGacha(snap);

  const withRealized = packs.filter((p) => (p.realized?.n ?? 0) > 0).length;
  const topHitUsd = bigHits[0]?.valueUsd ?? 0;
  log(
    `snapshot: ${packs.length} live public packs (${droppedArchived} archived dropped, ${withRealized} with realized stats) · ${bigHits.length} hits (top $${Math.round(topHitUsd).toLocaleString()})`,
  );

  await recordFreshness("cc-gacha", {
    status: packs.length > 0 ? "ok" : "error",
    rowsWritten: winners.length,
    durationMs: Date.now() - startedAt,
    generatedAt,
  });

  return {
    machines: catalog.length,
    publicPacks: packs.length,
    sampledPulls: winners.length,
    bigHits: bigHits.length,
    topHitUsd,
    generatedAt,
  };
}
