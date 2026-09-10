import { unstable_cache } from "next/cache";
import { readSaleFeed, type UntaggedSale } from "./salePanel";
import { readCardMeta, type CardPlatform, type CardMeta } from "./cards";
import { canonicalGrade } from "./gradePremium";
import { dayStartUtc } from "./metricSnapshots";

/**
 * The 30-complete-day resale panel behind /ip/[key]/grades and /ip/[key]/sets.
 *
 * ⚠️ WINDOW FIRST, ENRICH SECOND — the tape's rule, for the same reason. The full
 * `buildSalePanel` joins every row of the `cards` table per platform (~51s for
 * Collector Crypt's 131,435 rows) to stratify the index. These pages need thirty
 * days, so they take the shared FEED, window it, and look up dims for only the
 * tokens that survived: measured 21.8s cold against 51s+ for the panel, and it is
 * behind a 30-minute cache, so a page render pays nothing.
 *
 * ⚠️ COMPLETE DAYS ONLY. The window ends at the last UTC midnight, never at "now"
 * — a partial trailing day would drag every share and every average toward
 * whatever happened to clear this morning. The same two-tier rule the spine
 * states: a rolling-24h hero number and this window legitimately differ.
 *
 * ⚠️ THE SET KEY AND THE GRADE LABEL COME FROM THE SSOTs, NOT FROM HERE.
 * `readCardMeta` already returns the canonical `setKey`/`setName`
 * (src/lib/card/setName.ts), and `canonicalGrade` folds "PSA 10.0" into "PSA 10"
 * and BECKETT into BGS before anything is grouped. A second normalisation on this
 * side would be a second answer: the page would bucket sales one way while the
 * blob's `grade:` / `set:` entities were built another, and the index column
 * would quietly stop lining up with the row it sits on.
 *
 * ⚠️ A TOKEN WHOSE DIMS DO NOT RESOLVE IS DROPPED, NOT DEFAULTED. `readCardMeta`
 * degrades a failed chunk to "no rows", and defaulting those to `ip: "other"` +
 * "Ungraded" would quietly move real PSA 10 volume into the ungraded bucket. They
 * are retried once and then excluded, with the count kept so the page can say so.
 */

export const WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export type PanelSale = {
  ts: string;
  tokenId: string;
  platform: CardPlatform;
  priceUsd: number;
  ip: string;
  grade: string;
  /** Canonical set key, or null when the raw value is not a set. */
  setKey: string | null;
  setName: string | null;
  cardName: string | null;
  image: string | null;
};

export type GradeSetPanel = {
  sales: PanelSale[];
  /** Inclusive window bounds, UTC day starts. */
  fromDay: string;
  toDay: string;
  /** Sales whose token dims never resolved — excluded from every figure. */
  unresolved: number;
};

async function metaWithRetry(platform: CardPlatform, ids: string[]): Promise<Map<string, CardMeta>> {
  const first = await readCardMeta(platform, ids).catch(() => new Map<string, CardMeta>());
  const missing = ids.filter((id) => !first.has(id));
  if (!missing.length) return first;
  // One retry for the chunk(s) that failed — a transient fetch error must not
  // silently shrink a month of volume.
  const second = await readCardMeta(platform, missing).catch(() => new Map<string, CardMeta>());
  for (const [k, v] of second) first.set(k, v);
  return first;
}

async function build(): Promise<GradeSetPanel> {
  // Complete days only: [toDay - 29d, toDay], where toDay is yesterday.
  const todayStart = Date.parse(dayStartUtc(Date.now()));
  const toDayMs = todayStart - DAY_MS;
  const fromDayMs = toDayMs - (WINDOW_DAYS - 1) * DAY_MS;

  const feed = await readSaleFeed({ sinceMs: fromDayMs });
  const windowed = feed.filter((r: UntaggedSale) => {
    const t = Date.parse(r.ts);
    return Number.isFinite(t) && t >= fromDayMs && t < todayStart && r.priceUsd > 0;
  });

  const byPlatform = new Map<CardPlatform, string[]>();
  for (const r of windowed) {
    const cur = byPlatform.get(r.platform);
    if (cur) cur.push(r.tokenId);
    else byPlatform.set(r.platform, [r.tokenId]);
  }
  const metas = new Map<CardPlatform, Map<string, CardMeta>>();
  await Promise.all(
    [...byPlatform].map(async ([p, ids]) => {
      metas.set(p, await metaWithRetry(p, [...new Set(ids)]));
    }),
  );

  const sales: PanelSale[] = [];
  let unresolved = 0;
  for (const r of windowed) {
    const m = metas.get(r.platform)?.get(r.tokenId);
    if (!m) { unresolved += 1; continue; }
      sales.push({
      ts: r.ts,
      tokenId: r.tokenId,
      platform: r.platform,
      priceUsd: r.priceUsd,
      ip: m.ip ?? "other",
      grade: canonicalGrade(m.grade),
      setKey: m.setKey,
      setName: m.setName,
      cardName: m.cardName?.trim() || m.name?.trim() || null,
      image: m.image ?? null,
    });
  }

  return {
    sales,
    fromDay: dayStartUtc(fromDayMs),
    toDay: dayStartUtc(toDayMs),
    unresolved,
  };
}

/** NEVER THROWS — a page that leads with a chart must not be able to 500 on a feed. */
export const getGradeSetPanel: () => Promise<GradeSetPanel> = unstable_cache(
  async () => {
    try {
      return await build();
    } catch {
      return { sales: [], fromDay: "", toDay: "", unresolved: 0 };
    }
  },
  ["grade-set-panel:v1"],
  { revalidate: 1800, tags: ["platform-buckets"] },
);

// ── Projections ────────────────────────────────────────────────────────────

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type GradeRow = {
  grade: string;
  volumeUsd: number;
  sales: number;
  cards: number;
  /** ⚠️ MEDIAN, not mean — a $40k chase sale would drag an average past every
   *  price actually paid in the bucket. */
  medianPriceUsd: number;
  sharePct: number;
  topSale: { name: string | null; priceUsd: number; tokenId: string; platform: CardPlatform } | null;
};

export function gradeRows(panel: GradeSetPanel, ip: string): GradeRow[] {
  const mine = panel.sales.filter((s) => s.ip === ip);
  const total = mine.reduce((t, s) => t + s.priceUsd, 0);
  const by = new Map<string, PanelSale[]>();
  for (const s of mine) {
    const a = by.get(s.grade);
    if (a) a.push(s);
    else by.set(s.grade, [s]);
  }
  return [...by.entries()]
    .map(([grade, rows]) => {
      const volumeUsd = rows.reduce((t, s) => t + s.priceUsd, 0);
      const top = rows.reduce<PanelSale | null>((b, s) => (b == null || s.priceUsd > b.priceUsd ? s : b), null);
      return {
        grade,
        volumeUsd,
        sales: rows.length,
        cards: new Set(rows.map((s) => s.tokenId)).size,
        medianPriceUsd: median(rows.map((s) => s.priceUsd)),
        // A share of nothing is not 0% — but `total` is only 0 when the bucket is
        // empty too, in which case there is no row here at all.
        sharePct: total > 0 ? (volumeUsd / total) * 100 : 0,
        topSale: top ? { name: top.cardName, priceUsd: top.priceUsd, tokenId: top.tokenId, platform: top.platform } : null,
      };
    })
    .sort((a, b) => b.volumeUsd - a.volumeUsd);
}

export type SetRow = {
  setKey: string;
  name: string;
  volumeUsd: number;
  sales: number;
  cards: number;
  medianPriceUsd: number;
  topSale: { name: string | null; priceUsd: number } | null;
};

export function setRows(panel: GradeSetPanel, ip: string): SetRow[] {
  const by = new Map<string, PanelSale[]>();
  for (const s of panel.sales) {
    // ⚠️ A null setKey is NOT a set called "Unknown". The raw value was junk
    // ("Game", "-", empty), and inventing a bucket for it would put a fabricated
    // row near the top of a leaderboard about which sets carry the market.
    if (s.ip !== ip || !s.setKey) continue;
    const a = by.get(s.setKey);
    if (a) a.push(s);
    else by.set(s.setKey, [s]);
  }
  return [...by.entries()]
    .map(([setKey, rows]) => {
      const top = rows.reduce<PanelSale | null>((b, s) => (b == null || s.priceUsd > b.priceUsd ? s : b), null);
      return {
        setKey,
        name: rows[0].setName ?? setKey,
        volumeUsd: rows.reduce((t, s) => t + s.priceUsd, 0),
        sales: rows.length,
        cards: new Set(rows.map((s) => s.tokenId)).size,
        medianPriceUsd: median(rows.map((s) => s.priceUsd)),
        topSale: top ? { name: top.cardName, priceUsd: top.priceUsd } : null,
      };
    })
    .sort((a, b) => b.volumeUsd - a.volumeUsd);
}

/** Sales of one set, newest first — the set page's top-sales strip and table. */
export function setSales(panel: GradeSetPanel, ip: string, setKey: string): PanelSale[] {
  return panel.sales
    .filter((s) => s.ip === ip && s.setKey === setKey)
    .sort((a, b) => b.ts.localeCompare(a.ts));
}

export type ShareDay = { ts: string; byGrade: Record<string, number>; total: number };

/**
 * Daily volume by grade for the 100% stacked chart.
 *
 * ⚠️ A DAY WITH NO VOLUME CARRIES NO SHARES — it is omitted, not written as a row
 * of zeros. Zeros would draw a column of empty stack at 0% and read as "every
 * grade went quiet", which is a different claim from "nothing cleared".
 */
export function gradeShareDaily(panel: GradeSetPanel, ip: string, grades: string[]): ShareDay[] {
  const keep = new Set(grades);
  const byDay = new Map<string, Map<string, number>>();
  for (const s of panel.sales) {
    if (s.ip !== ip) continue;
    const g = keep.has(s.grade) ? s.grade : "Other";
    const day = dayStartUtc(Date.parse(s.ts));
    let m = byDay.get(day);
    if (!m) { m = new Map(); byDay.set(day, m); }
    m.set(g, (m.get(g) ?? 0) + s.priceUsd);
  }
  return [...byDay.entries()]
    .map(([ts, m]) => {
      const total = [...m.values()].reduce((t, v) => t + v, 0);
      return { ts, byGrade: Object.fromEntries(m), total };
    })
    .filter((d) => d.total > 0)
    .sort((a, b) => a.ts.localeCompare(b.ts));
}
