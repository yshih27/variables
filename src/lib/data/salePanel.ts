/**
 * Sale-price panel — the substrate for the constant-quality price index (B1).
 *
 * Row-level sales (tokenId × ts × priceUsd) tagged with {ip, set, grade} from the
 * `cards` table, drawn from every platform's row-level feed:
 *   • Collector Crypt — Dune 7675297 (30d)
 *   • Courtyard       — Dune 7845248 (full history; but `cards` is empty for it →
 *                       ip/set/grade fall to "other"/null, so it can't be stratified
 *                       per-IP yet — lands in "other" until traded-mint enrichment)
 *   • Beezie          — its own /activity feed (full history)
 *   • Phygitals       — omitted: no clean row-level secondary feed (its sales API is
 *                       gacha-dominated). Add when a Phygitals secondary query lands.
 *
 * Wash filter: drop self-trades (buyer === seller). Prices are trade-time USD (the
 * feeds normalize already). Winsorization is applied per-cell in the estimator.
 */
import { readSecondarySales } from "./secondarySalesCache";
import { fetchBeezieSales } from "../beezie/market";
import { readCardDims, type CardPlatform } from "./cards";
import type { NormalizedSale } from "../rarible/queries";

export type SaleRow = {
  ts: string; // ISO sale time
  tokenId: string;
  priceUsd: number;
  platform: CardPlatform;
  ip: string;
  set: string | null;
  grade: string;
};

/**
 * One sale, before the cards-table dims join.
 *
 * ⚠️ THE SPLIT IS A PERFORMANCE BOUNDARY, NOT A SEMANTIC ONE. Everything that
 * decides whether a row COUNTS — the positive-price check and the self-trade
 * wash drop — happens here, so any caller taking this feed gets the same rows the
 * panel does. Only the descriptive dims (ip/set/grade) are added later.
 */
export type UntaggedSale = {
  ts: string;
  tokenId: string;
  priceUsd: number;
  platform: CardPlatform;
};

/** Apply the wash + price filter to one platform's feed. The ONE copy of that rule. */
function cleanPlatform(platform: CardPlatform, sales: NormalizedSale[], sinceMs?: number): UntaggedSale[] {
  const out: UntaggedSale[] = [];
  for (const s of sales) {
    if (!(s.priceUsd > 0)) continue;
    if (s.buyer && s.seller && s.buyer === s.seller) continue; // self-trade / wash
    if (sinceMs != null) {
      const t = Date.parse(s.date);
      if (!Number.isFinite(t) || t < sinceMs) continue;
    }
    out.push({ ts: s.date, tokenId: s.tokenId, priceUsd: s.priceUsd, platform });
  }
  return out;
}

/**
 * The cross-platform sale feed, filtered but NOT dims-tagged.
 *
 * ⚠️ EXISTS BECAUSE THE DIMS JOIN IS THE EXPENSIVE HALF, BY TWO ORDERS OF
 * MAGNITUDE. Measured: the three feeds together take ~3.5s, while
 * `readCardDims("collector-crypt")` alone takes ~51s for its 131,435 rows. A
 * caller that wants the last day's few dozen sales (the tape) should window here
 * and look up dims for the tokens it actually kept, not pay a full-table join to
 * throw away 99.9% of it.
 *
 * `sinceMs` also shortens the Beezie leg, which is a live `/activity` request.
 */
export async function readSaleFeed(opts: { sinceMs?: number } = {}): Promise<UntaggedSale[]> {
  const { sinceMs } = opts;
  // Beezie's window is derived from `sinceMs` when given (plus a day of slack for
  // clock skew at the boundary), else ~all history for the panel.
  const beezieWindowMs = sinceMs != null ? Math.max(Date.now() - sinceMs, 0) + DAY_MS : 800 * DAY_MS;
  const [cc, cy, bz] = await Promise.all([
    readSecondarySales("collector-crypt").catch(() => [] as NormalizedSale[]),
    readSecondarySales("courtyard").catch(() => [] as NormalizedSale[]),
    fetchBeezieSales(beezieWindowMs).catch(() => [] as NormalizedSale[]),
  ]);
  return [
    ...cleanPlatform("collector-crypt", cc, sinceMs),
    ...cleanPlatform("courtyard", cy, sinceMs),
    ...cleanPlatform("beezie", bz, sinceMs),
  ];
}

const DAY_MS = 86_400_000;

/** Tag one platform's cleaned sales with cards-table dims. */
async function tagPlatform(platform: CardPlatform, sales: UntaggedSale[]): Promise<SaleRow[]> {
  const dims = await readCardDims(platform);
  return sales.map((s) => {
    const d = dims.get(s.tokenId);
    return {
      ts: s.ts,
      tokenId: s.tokenId,
      priceUsd: s.priceUsd,
      platform,
      ip: d?.ip ?? "other",
      set: d?.set ?? null,
      grade: d?.grade ?? "Ungraded",
    };
  });
}

/**
 * Build the full cross-platform sale-price panel. A failing feed degrades to an
 * empty contribution (logged by the caller via the returned counts) rather than
 * sinking the whole panel.
 */
export async function buildSalePanel(): Promise<SaleRow[]> {
  // CC + Courtyard come from the secondary-sales store runCoreWarm writes — the
  // same cleaned rows the old direct Dune reads returned, without re-buying the
  // export (~5.6 cr each). Only warmers/core touches Dune for these feeds now.
  const feed = await readSaleFeed();
  const byPlatform = new Map<CardPlatform, UntaggedSale[]>();
  for (const s of feed) {
    const cur = byPlatform.get(s.platform);
    if (cur) cur.push(s);
    else byPlatform.set(s.platform, [s]);
  }
  const tagged = await Promise.all(
    [...byPlatform].map(([platform, sales]) => tagPlatform(platform, sales)),
  );
  return tagged.flat();
}
