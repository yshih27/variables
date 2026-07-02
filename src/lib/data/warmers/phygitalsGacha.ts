/**
 * Phygitals GACHA warmer (CLAW feed) — the pull→prize vertical Dune can't give us.
 *
 * Dune already supplies Phygitals' long-window VOLUME (pulls/vol/buyback over
 * 24h/7d/30d). What it CANNOT supply is the link between a pull and its prize:
 * on Dune the $X pay-in and the prize NFT delivery are separate txs. Phygitals'
 * public /sales feed carries both in one CLAW row (clawId + ebayListing.fmv), so
 * here we derive realized prize-value ODDS, per-pack EV, and biggest HITS.
 *
 * ⚠️ The feed's offset pagination is unreliable for deep traversal (non-monotonic,
 * re-serves its recent window, saturates after a few pages). So one scan is only
 * a recent SAMPLE. The robust design — and what the rest of this project does —
 * is to ACCUMULATE: each run ingests whatever unique pulls it can into the
 * durable `gacha_pulls` table (idempotent by txid), then computes odds/EV from
 * the ACCUMULATED window (default 7d), which fills in and stabilizes over runs.
 * Biggest hits are kept as a running, windowed top-15 in the snapshot so their
 * art survives even when a given scan saturates early.
 *
 * Writes: the page-facing snapshot (snapshots key='gacha:phygitals') + the
 * normalized spine (gacha_products / gacha_pulls / gacha_metrics, per DATA_MODEL).
 * Shared by the CLI (scripts/warm-phygitals-gacha.ts) and the cron route.
 */
import { fetchPhygitalsClawFeed, type PhygitalsPull } from "../../phygitals/client";
import {
  readPhygitalsGacha,
  writePhygitalsGacha,
  PHYGITALS_VALUE_BANDS,
  type PhygitalsGachaSnapshot,
  type PhygitalsGachaProduct,
} from "../phygitalsGachaCache";
import type { GachaBigHit, GachaOddsTier } from "../gachaDuneCache";
import { db } from "../../db/client";

/** A pack needs at least this many pulls in the window to earn a "best-EV" claim. */
const MIN_PULLS_FOR_EV = 10;
const MAX_BIG_HITS = 15;
const DEFAULT_WINDOW_DAYS = 7;
const READBACK_LIMIT = 8000;

/** One pull, reduced to the numerics we keep in the durable spine. */
type AccPull = { clawId: string; priceUsd: number; fmvUsd: number | null; time: string };

function catKey(category: string | null): string | null {
  if (!category) return null;
  return category.trim().toLowerCase().replace(/\s+/g, "_");
}
function catLabel(key: string | null): string {
  if (!key) return "";
  if (key === "pokemon") return "Pokémon";
  if (key === "one_piece") return "One Piece";
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

/** Modal (most common) value in a list — packs price consistently per clawId. */
function modal(nums: number[]): number {
  const c = new Map<number, number>();
  let best = nums[0] ?? 0;
  let bestN = 0;
  for (const n of nums) {
    const k = (c.get(n) ?? 0) + 1;
    c.set(n, k);
    if (k > bestN) {
      bestN = k;
      best = n;
    }
  }
  return best;
}

/** Pretty pack name from clawId + price + category. */
function productName(clawId: string, priceUsd: number, catK: string | null): string {
  if (/[a-z]/i.test(clawId) && !/^\d+$/.test(clawId)) {
    // Phygitals slugs end in a 6-char random hash, e.g. "elite-one-piece-pack-9ovh6m".
    // Strip just that trailing hash; keep every real word ("mythic", "villain", …).
    const words = clawId.replace(/-[a-z0-9]{6}$/i, "").split("-").filter(Boolean).join(" ").trim();
    if (words) return words.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const label = catLabel(catK);
  return `$${Math.round(priceUsd)}${label ? ` ${label}` : ""} Pack`;
}

/** clawId → category, learned from the rich current scan (the spine has no category). */
function categoriesFromScan(pulls: PhygitalsPull[]): Map<string, string | null> {
  const byClaw = new Map<string, string[]>();
  for (const p of pulls) {
    const k = catKey(p.prizeCategory);
    if (!k) continue;
    const arr = byClaw.get(p.clawId);
    if (arr) arr.push(k);
    else byClaw.set(p.clawId, [k]);
  }
  const out = new Map<string, string | null>();
  for (const [claw, cats] of byClaw) {
    const counts = new Map<string, number>();
    for (const c of cats) counts.set(c, (counts.get(c) ?? 0) + 1);
    out.set(claw, [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null);
  }
  return out;
}

function buildProducts(
  pulls: AccPull[],
  categoryMap: Map<string, string | null>,
): PhygitalsGachaProduct[] {
  const groups = new Map<string, AccPull[]>();
  for (const p of pulls) {
    const id = p.clawId || "unknown";
    const g = groups.get(id);
    if (g) g.push(p);
    else groups.set(id, [p]);
  }
  const products: PhygitalsGachaProduct[] = [];
  for (const [clawId, ps] of groups) {
    const priceUsd = modal(ps.map((p) => p.priceUsd).filter((n) => n > 0));
    const fmvs = ps
      .map((p) => p.fmvUsd)
      .filter((v): v is number => v != null && v > 0)
      .sort((a, b) => a - b);
    if (fmvs.length === 0 || priceUsd <= 0) continue;
    const meanFmv = fmvs.reduce((s, v) => s + v, 0) / fmvs.length;
    const catK = categoryMap.get(clawId) ?? null;
    products.push({
      clawId,
      name: productName(clawId, priceUsd, catK),
      category: catK,
      priceUsd,
      pulls: ps.length,
      meanFmvUsd: meanFmv,
      medianFmvUsd: median(fmvs),
      maxFmvUsd: fmvs[fmvs.length - 1],
      evMultiple: meanFmv / priceUsd,
    });
  }
  return products.sort((a, b) => b.pulls - a.pulls);
}

/** Realized prize-value distribution (fmv/price), bucketed into the value bands. */
function buildValueOdds(pulls: AccPull[]): GachaOddsTier[] {
  const counts = PHYGITALS_VALUE_BANDS.map(() => 0);
  let total = 0;
  for (const p of pulls) {
    if (p.fmvUsd == null || p.fmvUsd <= 0 || p.priceUsd <= 0) continue;
    const m = p.fmvUsd / p.priceUsd;
    const i = PHYGITALS_VALUE_BANDS.findIndex((b) => m >= b.minMult && m < b.maxMult);
    if (i >= 0) {
      counts[i]++;
      total++;
    }
  }
  return PHYGITALS_VALUE_BANDS.map((b, i) => ({
    tier: b.label,
    prizes24h: counts[i],
    prizes7d: counts[i],
    prizes30d: counts[i],
    pct: total > 0 ? counts[i] / total : 0,
    hit: b.hit,
  }));
}

/** Biggest hits from THIS scan (rich: name + art), unsliced — merged below. */
function hitsFromScan(pulls: PhygitalsPull[]): GachaBigHit[] {
  const out: GachaBigHit[] = [];
  for (const p of pulls) {
    if (!p.prizeMint || p.prizeFmvUsd == null || p.prizeFmvUsd <= 0) continue;
    out.push({
      platform: "phygitals",
      mint: p.prizeMint,
      name: p.prizeName ?? p.prizeMint.slice(0, 8),
      tier: "", // no rarity tier on Phygitals — coverflow uses the value fallback
      valueUsd: p.prizeFmvUsd,
      image: p.prizeImage,
      imageFallback: null,
      at: p.time,
      pack: productName(p.clawId, p.pricePaidUsd, catKey(p.prizeCategory)),
    });
  }
  return out;
}

/**
 * Running, windowed top hits: union the previous snapshot's hits with this
 * scan's, keep the highest FMV per mint, drop anything older than the window,
 * and take the top N by FMV. Survives early-saturating scans.
 */
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

/**
 * Best realized-EV pack: highest value retained among packs with ENOUGH pulls to
 * be trustworthy. Returns null when no pack clears the bar — better to show
 * "soon" in the hero than a number built on 2 pulls. Fills in as the spine grows.
 */
function pickBestEv(products: PhygitalsGachaProduct[]): PhygitalsGachaProduct | null {
  return products
    .filter((p) => p.pulls >= MIN_PULLS_FOR_EV)
    .reduce<PhygitalsGachaProduct | null>(
      (best, p) => (!best || p.evMultiple > best.evMultiple ? p : best),
      null,
    );
}

export type PhygitalsGachaWarmResult = {
  scannedPulls: number;
  windowPulls: number;
  products: number;
  bigHits: number;
  topHitUsd: number;
  realizedEv: number | null;
  windowHours: number | null;
  generatedAt: string;
  /** Provenance for the runWarmer freshness row. */
  rowsWritten?: number;
};

/** Ingest pulls into the durable gacha_pulls spine (idempotent by txid). Shared
 *  by the 6h warmer and the real-time listener (scripts/listen-gacha.ts). */
export async function ingestPhygitalsPulls(pulls: PhygitalsPull[]): Promise<void> {
  const rows = pulls
    .filter((p) => p.clawId)
    .map((p) => ({
      pull_id: `phygitals:${p.txid}`,
      platform_id: "phygitals",
      product_id: `phygitals:${p.clawId}`,
      buyer: p.buyer,
      price_usd: p.pricePaidUsd,
      prize_instance_id: p.prizeMint ? `pg-${p.prizeMint}` : null,
      prize_value_usd: p.prizeFmvUsd,
      tx_hash: p.txid,
      source: "phygitals-api",
      pulled_at: p.time,
    }));
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db().from("gacha_pulls").upsert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`gacha_pulls: ${error.message}`);
  }
}

/** Read the accumulated pull window back out of the spine. */
async function readbackWindow(sinceISO: string): Promise<AccPull[]> {
  const { data, error } = await db()
    .from("gacha_pulls")
    .select("product_id, price_usd, prize_value_usd, pulled_at")
    .eq("platform_id", "phygitals")
    .gte("pulled_at", sinceISO)
    .order("pulled_at", { ascending: false })
    .limit(READBACK_LIMIT);
  if (error) throw new Error(`gacha_pulls readback: ${error.message}`);
  return (data ?? []).map((r) => ({
    clawId: String(r.product_id ?? "").replace(/^phygitals:/, ""),
    priceUsd: Number(r.price_usd) || 0,
    fmvUsd: r.prize_value_usd != null ? Number(r.prize_value_usd) : null,
    time: String(r.pulled_at),
  }));
}

/** Persist gacha_products + gacha_metrics (the page reads the snapshot; these are the spine). */
async function writeAggregates(
  products: PhygitalsGachaProduct[],
  odds: GachaOddsTier[],
  windowPulls: number,
  windowVolUsd: number,
  generatedAt: string,
): Promise<void> {
  if (products.length) {
    const { error } = await db()
      .from("gacha_products")
      .upsert(
        products.map((p) => ({
          product_id: `phygitals:${p.clawId}`,
          platform_id: "phygitals",
          category_id: p.category,
          name: p.name,
          claw_id: p.clawId,
          price_usd: p.priceUsd,
          active: true,
          updated_at: generatedAt,
        })),
      );
    if (error) throw new Error(`gacha_products: ${error.message}`);
  }
  const metricRows: Record<string, unknown>[] = [
    {
      scope: "platform",
      scope_id: "phygitals",
      period: "recent",
      pulls: windowPulls,
      volume_usd: windowVolUsd,
      odds,
      generated_at: generatedAt,
      source: "phygitals-api",
    },
    ...products.map((p) => ({
      scope: "price_tier",
      scope_id: `phygitals:${p.clawId}`,
      period: "recent",
      pulls: p.pulls,
      volume_usd: p.pulls * p.priceUsd,
      odds: { ev_multiple: p.evMultiple, mean_fmv: p.meanFmvUsd, max_fmv: p.maxFmvUsd },
      generated_at: generatedAt,
      source: "phygitals-api",
    })),
  ];
  const { error } = await db().from("gacha_metrics").upsert(metricRows);
  if (error) throw new Error(`gacha_metrics: ${error.message}`);
}

export async function runPhygitalsGachaWarm(
  opts: {
    maxPages?: number;
    maxPulls?: number;
    windowDays?: number;
    log?: (m: string) => void;
  } = {},
): Promise<PhygitalsGachaWarmResult> {
  const log = opts.log ?? (() => {});
  const startedAt = Date.now();
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const sinceMs = startedAt - windowDays * 86_400_000;
  const sinceISO = new Date(sinceMs).toISOString();

  // 1. Harvest a recent sample of unique pulls from the (flaky) feed.
  const feed = await fetchPhygitalsClawFeed({
    maxPages: opts.maxPages ?? 300,
    maxPulls: opts.maxPulls,
    log,
  });

  // 2. Ingest into the durable spine so the window accumulates across runs.
  await ingestPhygitalsPulls(feed.pulls);

  // 3. Compute odds/EV/products from the ACCUMULATED window (robust to thin scans).
  const windowPulls = await readbackWindow(sinceISO);
  const categoryMap = categoriesFromScan(feed.pulls);
  const products = buildProducts(windowPulls, categoryMap);
  const odds = buildValueOdds(windowPulls);
  const bestEv = pickBestEv(products);

  const valued = windowPulls.filter((p) => p.fmvUsd != null && p.fmvUsd > 0 && p.priceUsd > 0);
  const sumFmv = valued.reduce((s, p) => s + (p.fmvUsd as number), 0);
  const sumPrice = valued.reduce((s, p) => s + p.priceUsd, 0);
  const realizedEvMultiple = sumPrice > 0 ? sumFmv / sumPrice : null;
  const windowVolUsd = windowPulls.reduce((s, p) => s + p.priceUsd, 0);

  // 4. Running, windowed biggest hits (art persists across early-saturating scans).
  const prev = await readPhygitalsGacha();
  const bigHits = mergeBigHits(prev?.bigHits ?? [], hitsFromScan(feed.pulls), sinceMs);

  // Honest window span = actual min/max of the accumulated pulls.
  const times = windowPulls.map((p) => Date.parse(p.time)).filter(Number.isFinite);
  const fromMs = times.length ? Math.min(...times) : NaN;
  const toMs = times.length ? Math.max(...times) : NaN;
  const actualHours =
    Number.isFinite(fromMs) && Number.isFinite(toMs) ? (toMs - fromMs) / 3_600_000 : null;

  const generatedAt = new Date().toISOString();
  const snap: PhygitalsGachaSnapshot = {
    generatedAt,
    window: {
      fromISO: Number.isFinite(fromMs) ? new Date(fromMs).toISOString() : null,
      toISO: Number.isFinite(toMs) ? new Date(toMs).toISOString() : null,
      hours: actualHours,
      pulls: windowPulls.length,
      pagesScanned: feed.pagesScanned,
    },
    odds,
    products,
    bestEv,
    realizedEvMultiple,
    bigHits,
  };
  await writePhygitalsGacha(snap);
  log(
    `snapshot: ${feed.pulls.length} new pulls → ${windowPulls.length} in ${windowDays}d window · ${products.length} packs · EV ${realizedEvMultiple != null ? realizedEvMultiple.toFixed(2) + "×" : "—"} · ${bigHits.length} hits (top $${Math.round(bigHits[0]?.valueUsd ?? 0).toLocaleString()})`,
  );

  // 5. Spine aggregates — best-effort (snapshot is already live).
  try {
    await writeAggregates(products, odds, windowPulls.length, windowVolUsd, generatedAt);
    log(`  spine: ${products.length} products + ${products.length + 1} metric rows`);
  } catch (err) {
    log(`  spine aggregates FAILED (snapshot is still live): ${(err as Error).message}`);
  }

  // Soft-fail: no pulls landed in the window → throw so the runWarmer wrapper
  // records an error row (health gate) instead of a silent empty window.
  if (windowPulls.length === 0) {
    throw new Error("phygitals-gacha: 0 pulls in window (CLAW feed empty/unreachable?)");
  }

  return {
    scannedPulls: feed.pulls.length,
    windowPulls: windowPulls.length,
    products: products.length,
    bigHits: bigHits.length,
    topHitUsd: bigHits[0]?.valueUsd ?? 0,
    realizedEv: realizedEvMultiple,
    windowHours: actualHours,
    generatedAt,
    rowsWritten: feed.pulls.length,
  };
}
