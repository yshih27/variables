/**
 * The tape — a single reverse-chronological feed of things that ACTUALLY
 * HAPPENED: cleared sales, big gacha pulls, and weekly index closes.
 *
 * ⚠️ REALIZED EVENTS ONLY. Nothing here is a listing, an appraisal, a comp, or a
 * projection. A tape that mixed those would read as a trade log while carrying
 * asks — which is the one thing a tape must not do. Everything below is a
 * derivation of snapshots the warmers already wrote; this module adds no new
 * Dune, Helius or CardOS read of its own.
 *
 * ⚠️ AND NO NEW FILTERING. The upstream hygiene (`cleanSecondarySales` on the
 * feeds, the self-trade drop in `buildSalePanel`) is the only filter applied. It
 * is tempting to add a price floor so the tape "looks" better, but a $3 sale is a
 * real trade, and hiding it would make the tape disagree with every volume figure
 * on the page that counted it.
 */
import { unstable_cache } from "next/cache";
import { readSaleFeed, type UntaggedSale } from "./salePanel";
import { readGachaDune } from "./gachaDuneCache";
import { mapBigHits } from "./gachaHits";
import { readIndexSeries } from "./indices";
import { readCardMeta, type CardPlatform } from "./cards";
import { cardHref, cardSupported } from "@/lib/card/ids";
import { tickerOf } from "@/lib/indices/naming";
import { parseGrade } from "@/lib/card/grade";
import { GACHA_ENABLED } from "@/lib/flags";
import { formatCompactUsd } from "@/lib/format";
import { IP_CATALOG, OTHER_IP } from "./ipCatalog";
import type { IPCategory } from "./ipCatalog";
import type { TapeItem } from "@/lib/types";

const DAY = 86_400_000;
/** Sales and pulls older than this never reach the tape. */
const EVENT_WINDOW_MS = DAY;
/**
 * Index closes get a longer leash BY DESIGN: the price index is weekly and
 * stamped at the week end, so its newest close is up to seven days old on any
 * given day. Dropping it at 24h would mean the tape simply never shows an index
 * close. The label carries the age instead — see `indexItems`.
 */
const INDEX_WINDOW_MS = 8 * DAY;

const IP_NAME = new Map([...IP_CATALOG, OTHER_IP].map((ip) => [ip.key, ip.name]));

/** "$1,240" or "—". Never "$0" for an absent figure. */
function valueText(usd: number | null): string {
  return usd != null && Number.isFinite(usd) ? formatCompactUsd(usd) : "—";
}

// ── Sales ──────────────────────────────────────────────────────────────────

/**
 * Cleared sales in the window → tape items.
 *
 * ⚠️ WINDOW FIRST, ENRICH SECOND — and the order is worth 51 seconds. The sale
 * panel's dims join reads every row of the `cards` table per platform (131,435
 * for Collector Crypt alone, measured at ~51s) which is right for the index's
 * stratification and absurd for showing forty rows. So the tape takes the shared
 * FEED (`readSaleFeed`, same wash filter, no dims), windows it to 24h, and then
 * looks up metadata for only the tokens that survived.
 *
 * A token we hold no metadata for falls back to "{IP} · {grade}" — honest, still
 * says what traded, and never invents a card name.
 */
async function saleItems(rows: UntaggedSale[], nowMs: number, limit: number): Promise<TapeItem[]> {
  const recent = rows
    .filter((r) => {
      const t = Date.parse(r.ts);
      return Number.isFinite(t) && nowMs - t <= EVENT_WINDOW_MS && t <= nowMs;
    })
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, limit);
  if (!recent.length) return [];

  // One metadata read per platform, for the windowed tokens only.
  const byPlatform = new Map<CardPlatform, string[]>();
  for (const r of recent) {
    const cur = byPlatform.get(r.platform);
    if (cur) cur.push(r.tokenId);
    else byPlatform.set(r.platform, [r.tokenId]);
  }
  const metas = new Map<string, Awaited<ReturnType<typeof readCardMeta>>>();
  await Promise.all(
    [...byPlatform].map(async ([p, ids]) => {
      metas.set(p, await readCardMeta(p, ids).catch(() => new Map()));
    }),
  );

  return recent.map((r) => {
    const m = metas.get(r.platform)?.get(r.tokenId);
    const name = m?.cardName?.trim() || m?.name?.trim() || null;
    const ipKey = m?.ip ?? "other";
    const ipName = IP_NAME.get(ipKey) ?? ipKey;
    // `grade` off the cards table is already the canonical label ("PSA 10");
    // "Ungraded" is a real state worth omitting rather than printing.
    // Card NAMES carry the grade inline (grade SSOT: src/lib/card/grade.ts), so
    // appending the cards-table grade again printed "… PSA 9 · PSA 9". Append it
    // only when the name does not already parse a grade.
    const nameHasGrade = !!(name && parseGrade(name));
    const graded = !nameHasGrade && m?.grade && m.grade !== "Ungraded" ? m.grade : null;
    const label = name
      ? [name, graded].filter(Boolean).join(" · ")
      : [ipName, graded].filter(Boolean).join(" · ");
    const usd = Number.isFinite(r.priceUsd) && r.priceUsd > 0 ? r.priceUsd : null;
    return {
      ts: r.ts,
      kind: "sale" as const,
      label,
      valueUsd: usd,
      valueText: valueText(usd),
      platform: r.platform,
      href: cardSupported(r.platform) ? cardHref(r.platform, r.tokenId) : `/ip/${ipKey}`,
      // tokenId is unique per platform and a token can trade twice in a window,
      // so the timestamp is part of the key.
      id: `sale:${r.platform}:${r.tokenId}:${r.ts}`,
    };
  });
}

// ── Pulls ──────────────────────────────────────────────────────────────────

/**
 * Big gacha pulls, and ONLY when GACHA_ENABLED.
 *
 * ⚠️ This is the flag's UI-surface meaning, not its aggregate meaning: gacha
 * volume still counts toward market totals with the flag off (see src/lib/flags.ts),
 * but a pull is a visible gacha event and the tape is a visible surface. With the
 * flag off the tape simply has no pull lines.
 */
async function pullItems(nowMs: number, limit: number): Promise<TapeItem[]> {
  if (!GACHA_ENABLED) return [];
  const snap = await readGachaDune().catch(() => null);
  const raw = snap?.bigHits ?? [];
  if (!raw.length) return [];
  // mapBigHits owns the 24h-vs-recent decision and the display shaping; reusing
  // it keeps the tape's pull lines identical to the hits ticker's.
  const { hits } = mapBigHits(raw, nowMs, limit);
  // Pulls get the INDEX-CLOSE treatment, not the sale treatment (user ruling,
  // Sep 3): the big-hits snapshot refreshes weekly, so a pull is days old by
  // construction. Older points are allowed and the label states the age, so a
  // 4-day-old rip can never sit beside a 3-minute-old sale looking equally fresh.
  return hits
    .filter((h) => {
      const t = Date.parse(h.at);
      return Number.isFinite(t) && t <= nowMs;
    })
    .map((h) => {
      const usd = Number.isFinite(h.hitValueUsd) && h.hitValueUsd > 0 ? h.hitValueUsd : null;
      const ageDays = Math.floor((nowMs - Date.parse(h.at)) / DAY);
      const age = ageDays >= 1 ? ` · ${ageDays}d ago` : "";
      return {
        ts: h.at,
        kind: "pull" as const,
        label: [h.name, h.grade].filter(Boolean).join(" · ") + age,
        valueUsd: usd,
        valueText: valueText(usd),
        platform: h.platformKey,
        href: cardSupported(h.platformKey) ? cardHref(h.platformKey, h.mint) : "/gacha",
        id: `pull:${h.platformKey}:${h.mint}:${h.at}`,
      };
    });
}

// ── Index closes ───────────────────────────────────────────────────────────

const INDEX_SCOPES: { entity: "market" | "category"; key: string }[] = [
  { entity: "market", key: "total" },
  ...(["tcg", "sports", "other"] as IPCategory[]).map((k) => ({ entity: "category" as const, key: k })),
];

/**
 * One item per complete week per index, stamped at the week END (the house
 * convention — see resampleWeekly). The label states the close, the 1-week move,
 * and, when the point is more than a day old, how old it is: a weekly series'
 * newest point is usually days behind, and a bare number would read as "as of
 * now" on a feed where every other line is minutes old.
 */
async function indexItems(nowMs: number, limit: number): Promise<TapeItem[]> {
  const out: TapeItem[] = [];
  const results = await Promise.all(
    INDEX_SCOPES.map(async (s) => {
      const pts = await readIndexSeries(s.entity, s.key, {
        kind: "price",
        from: "2000-01-01",
        freq: "weekly",
      }).catch(() => []);
      return { s, pts };
    }),
  );
  for (const { s, pts } of results) {
    const ticker = tickerOf(s.entity, s.key);
    // Newest-first, and only the last few weeks — the tape is a feed, not an archive.
    let takenForScope = 0;
    for (let i = pts.length - 1; i >= 1 && takenForScope < limit; i--) {
      const p = pts[i];
      const prev = pts[i - 1];
      const t = Date.parse(p.ts);
      if (!Number.isFinite(t) || t > nowMs || nowMs - t > INDEX_WINDOW_MS) continue;
      if (!Number.isFinite(p.value)) continue;
      const pct = Number.isFinite(prev?.value) && prev.value > 0 ? ((p.value - prev.value) / prev.value) * 100 : null;
      const ageDays = Math.floor((nowMs - t) / DAY);
      const move = pct == null ? "" : ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% 1w)`;
      const age = ageDays >= 1 ? ` · ${ageDays}d ago` : "";
      takenForScope++;
      out.push({
        ts: p.ts,
        kind: "index",
        label: `${ticker} closed ${p.value.toFixed(2)}${move}${age}`,
        // An index LEVEL is not dollars. Publishing 231.01 in a USD column is the
        // unit error this whole codebase's honesty rules exist to prevent.
        valueUsd: null,
        valueText: p.value.toFixed(2),
        href: s.entity === "market" ? "/ips" : `/ips?cat=${s.key}`,
        id: `index:${s.entity}:${s.key}:${p.ts}`,
      });
    }
  }
  return out;
}

// ── Assembly ───────────────────────────────────────────────────────────────

/**
 * How many slots each non-sale kind is guaranteed before sales fill the rest.
 *
 * ⚠️ WITHOUT THIS THE TAPE IS ALL SALES. Sorting three sources newest-first and
 * truncating sounds neutral, but it is not: a busy 24h produces far more than
 * `limit` sales, every one of them newer than a weekly index close (which is
 * stamped at the week end and is therefore days old by construction). Measured on
 * the first build — 40 items, 40 sales, zero closes and zero pulls. The reserve
 * makes the tape the mixed feed it is supposed to be; display order stays strictly
 * newest-first, so nothing is presented out of sequence.
 */
const RESERVED = { index: 4, pull: 8 } as const;

/** The shell mounts the band only when a real feed exists. It does now. */
export const TAPE_AVAILABLE = true;

export async function buildTape(limit = 40): Promise<TapeItem[]> {
  const nowMs = Date.now();
  // Each leg degrades to [] on its own rather than sinking the tape: a feed that
  // vanishes because one of three sources blipped is worse than a shorter feed.
  const [sales, pulls, closes] = await Promise.all([
    readSaleFeed({ sinceMs: nowMs - EVENT_WINDOW_MS })
      .then((rows) => saleItems(rows, nowMs, limit))
      .catch(() => [] as TapeItem[]),
    pullItems(nowMs, RESERVED.pull).catch(() => [] as TapeItem[]),
    indexItems(nowMs, RESERVED.index).catch(() => [] as TapeItem[]),
  ]);

  const keptCloses = closes.slice(0, RESERVED.index);
  const keptPulls = pulls.slice(0, RESERVED.pull);
  const keptSales = sales.slice(0, Math.max(0, limit - keptCloses.length - keptPulls.length));

  const seen = new Set<string>();
  return [...keptSales, ...keptPulls, ...keptCloses]
    .filter((it) => {
      if (seen.has(it.id)) return false;
      seen.add(it.id);
      return true;
    })
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, limit);
}

/**
 * Cached for 5 minutes on the `platform-buckets` tag, so a warm that publishes
 * new figures sweeps the tape with them — otherwise the tape could show a sale
 * the rest of the page has not counted yet.
 */
export const getTape = unstable_cache(buildTape, ["shell-tape:v1"], {
  revalidate: 300,
  tags: ["platform-buckets"],
});
