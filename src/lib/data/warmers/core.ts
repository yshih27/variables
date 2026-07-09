/**
 * Core secondary-volume warmer — all native/Dune, no Rarible → Postgres.
 *
 * Produces the `core-volume` snapshot buckets.ts reads, so page renders make ZERO
 * request-time network calls. Per-platform secondary source:
 *   • collector-crypt → Dune CC_SECONDARY_QUERY_ID (on-chain; replaces Helius-429)
 *   • beezie          → its own /activity feed (api.beezie.com)
 *   • courtyard       → Dune COURTYARD_SECONDARY_QUERY_ID (nft.trades; replaces Rarible)
 *
 * Shared by the CLI (scripts/warm-core-dune.ts). Pass `cachedOnly` to read Dune's
 * last cached results (0 credits) instead of forcing a fresh execution.
 */
import { runQuery, getResultsAutoRefresh, type DuneRow } from "../../dune/client";
import { CC_SECONDARY_QUERY_ID, COURTYARD_SECONDARY_QUERY_ID } from "../../dune/queryIds";
import { cleanSecondarySales, formatHygiene } from "../secondaryHygiene";

// Self-heal a cached Dune secondary result older than this. Kept below 24h so the
// headline 24h window can never silently collapse to $0 while a scheduled fresh
// run is failing — the next 6h cached warm re-runs it fresh.
const CC_SECONDARY_MAX_CACHE_AGE_MS = 12 * 60 * 60 * 1000;
import { type CollectionStats, type NormalizedSale } from "../../rarible/queries";
import { fetchBeezieSales } from "../../beezie/market";
import {
  writeCoreVolume,
  type CorePlatformVolume,
  type CoreVolumeSnapshot,
} from "../coreVolumeCache";

const DAY = 24 * 60 * 60 * 1000;
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Dune block_time → ISO. Handles both "2026-06-08 07:30:00.000 UTC" and ISO. */
function duneTimeToIso(v: unknown): string {
  const s = String(v ?? "");
  const d = new Date(s.includes("T") ? s : s.replace(" UTC", "Z").replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function statsFromSaleList(collectionId: string, sales: NormalizedSale[]): CollectionStats {
  const volumeUsd = sales.reduce((s, x) => s + x.priceUsd, 0);
  return {
    collectionId,
    windowFrom: new Date(Date.now() - DAY).toISOString(),
    windowTo: new Date().toISOString(),
    salesCount: sales.length,
    volumeUsd,
    uniqueBuyers: new Set(sales.map((s) => s.buyer)).size,
    uniqueSellers: new Set(sales.map((s) => s.seller)).size,
    avgTradeUsd: sales.length ? volumeUsd / sales.length : 0,
  };
}

/**
 * Build one platform's volume entry from a sale list. `spanDays` = how far back we
 * can honestly report (≥30 ⇒ the list covers ≥30 days). 24h/7d/30d are computed as
 * windows OVER the list, so a longer (full-history) list is fine — only the partial
 * 24h day stored in `sales24h` is kept; older rows just feed the window sums.
 */
function buildPlatform(
  key: string,
  source: "dune" | "rarible" | "beezie",
  allSales: NormalizedSale[],
  spanDays: number,
): CorePlatformVolume {
  const now = Date.now();
  const within = (days: number) =>
    allSales.filter((s) => new Date(s.date).getTime() > now - days * DAY);
  const sumUsd = (xs: NormalizedSale[]) => xs.reduce((s, x) => s + x.priceUsd, 0);

  const s24 = within(1).sort((a, b) => b.date.localeCompare(a.date));
  return {
    source,
    stats24h: statsFromSaleList(key, s24),
    sales24h: s24,
    vol7dUsd: spanDays >= 7 ? sumUsd(within(7)) : null,
    vol30dUsd: spanDays >= 30 ? sumUsd(within(30)) : null,
    sales7dCount: spanDays >= 7 ? within(7).length : null,
    sales30dCount: spanDays >= 30 ? within(30).length : null,
  };
}

/**
 * Fetch sale-level rows `{ block_time, price_usd, nft_mint, buyer, seller }` from a
 * Dune secondary-sales query → NormalizedSale[]. `cachedOnly` does a self-healing
 * cached read (a stale cache triggers a fresh run). `maxRows` is generous so a
 * full-history query (Courtyard, 100k+ rows) isn't truncated at the 100k default.
 */
async function fetchDuneSecondarySales(
  queryId: number,
  label: string,
  opts: { cachedOnly?: boolean; log?: (msg: string) => void } = {},
): Promise<NormalizedSale[]> {
  let rows: DuneRow[];
  if (opts.cachedOnly) {
    const r = await getResultsAutoRefresh(queryId, {
      maxAgeMs: CC_SECONDARY_MAX_CACHE_AGE_MS,
      runOpts: { maxWaitMs: 480_000, maxRows: 250_000 },
      maxRows: 250_000,
    });
    rows = r.rows;
    if (r.refreshed) {
      const ageH = r.cachedAgeMs != null ? (r.cachedAgeMs / 3.6e6).toFixed(1) : "?";
      (opts.log ?? console.log)(`  ↻ ${label} cache stale (${ageH}h old) — self-healed with a fresh Dune run`);
    }
  } else {
    rows = await runQuery(queryId, { maxWaitMs: 480_000, maxRows: 250_000 });
  }
  const mapped = rows
    .map((r) => ({
      date: duneTimeToIso(r.block_time),
      tokenId: String(r.nft_mint ?? ""),
      buyer: String(r.buyer ?? ""),
      seller: String(r.seller ?? ""),
      priceUsd: num(r.price_usd),
    }))
    .filter((s) => s.priceUsd > 0 && s.tokenId);
  // D10-1: strip fan-out dupes, self-trades, and ring-wash at the source, so every
  // downstream reader (core volume, spine, trending, sale panel / price index,
  // getCardSales) sees the same clean feed. See secondaryHygiene.ts.
  const { sales, stats } = cleanSecondarySales(mapped);
  const line = formatHygiene(label, stats);
  if (line) (opts.log ?? console.log)(line);
  return sales;
}

/** CC secondary sales (Dune). Shared by the core warmer, the spine, and backfill. */
export async function fetchCCSecondarySales(
  opts: { cachedOnly?: boolean; log?: (msg: string) => void } = {},
): Promise<NormalizedSale[]> {
  return fetchDuneSecondarySales(CC_SECONDARY_QUERY_ID, "cc-secondary", opts);
}

/** Courtyard secondary sales (Dune nft.trades, full history). Replaces Rarible. */
export async function fetchCourtyardSecondarySales(
  opts: { cachedOnly?: boolean; log?: (msg: string) => void } = {},
): Promise<NormalizedSale[]> {
  return fetchDuneSecondarySales(COURTYARD_SECONDARY_QUERY_ID, "courtyard-secondary", opts);
}

export type CoreWarmResult = {
  platforms: number;
  ccSales30d: number;
  vol24hUsd: number;
  generatedAt: string;
  rowsWritten: number;
};

export async function runCoreWarm(
  opts: { cachedOnly?: boolean; log?: (msg: string) => void } = {},
): Promise<CoreWarmResult> {
  const log = opts.log ?? (() => {});
  const platforms: Record<string, CorePlatformVolume> = {};

  // ── Collector Crypt: Dune (full chain scan, no Helius 429) ──
  try {
    const t0 = Date.now();
    const ccSales = await fetchCCSecondarySales(opts);
    platforms["collector-crypt"] = buildPlatform("collector-crypt", "dune", ccSales, 30);
    log(
      `→ collector-crypt (Dune) ${ccSales.length} sales/30d · 24h $${Math.round(
        platforms["collector-crypt"].stats24h.volumeUsd,
      ).toLocaleString()} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
    );
  } catch (err) {
    log(`→ collector-crypt (Dune) FAILED: ${(err as Error).message}`);
  }

  // ── Beezie: its OWN /activity feed (no Rarible quota dependency). Reaches
  //    back months, so we get real 7d/30d too. This is the fix for the Pokémon
  //    $0 — Rarible's 429 used to drop Beezie sales entirely. ──
  try {
    const t0 = Date.now();
    const sales = await fetchBeezieSales(30 * DAY);
    platforms["beezie"] = buildPlatform("beezie", "beezie", sales, 30);
    log(
      `→ beezie (Beezie /activity) ${sales.length} sales/30d · 24h $${Math.round(
        platforms["beezie"].stats24h.volumeUsd,
      ).toLocaleString()} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
    );
  } catch (err) {
    log(`→ beezie (Beezie /activity) FAILED: ${(err as Error).message}`);
  }

  // ── Courtyard: Dune nft.trades (full history) — replaces Rarible. Its own
  //    api.courtyard.io is WAF-blocked to servers, so Dune is the off-Rarible path. ──
  try {
    const t0 = Date.now();
    const sales = await fetchCourtyardSecondarySales(opts);
    platforms["courtyard"] = buildPlatform("courtyard", "dune", sales, 30);
    log(
      `→ courtyard (Dune) ${sales.length} sales · 24h $${Math.round(
        platforms["courtyard"].stats24h.volumeUsd,
      ).toLocaleString()} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
    );
  } catch (err) {
    log(`→ courtyard (Dune) FAILED: ${(err as Error).message}`);
  }

  const snap: CoreVolumeSnapshot = {
    generatedAt: new Date().toISOString(),
    platforms,
  };
  await writeCoreVolume(snap);

  return {
    platforms: Object.keys(platforms).length,
    ccSales30d: platforms["collector-crypt"]?.sales30dCount ?? 0,
    vol24hUsd: Object.values(platforms).reduce((s, p) => s + p.stats24h.volumeUsd, 0),
    generatedAt: snap.generatedAt,
    rowsWritten: Object.keys(platforms).length,
  };
}
