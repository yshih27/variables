/**
 * Core secondary-volume warmer — Dune (CC) + Rarible (Beezie/Courtyard) → Postgres.
 *
 * Produces the `core-volume` snapshot buckets.ts reads, so page renders make ZERO
 * request-time network calls. Per the routing matrix (DATA_MODEL.md §5):
 *   • collector-crypt → Dune CC_SECONDARY_QUERY_ID (replaces the Helius-429 path)
 *   • beezie / courtyard → Rarible collectSales (aggregates OpenSea)
 *
 * Shared by the CLI (scripts/warm-core-dune.ts). Pass `cachedOnly` to read Dune's
 * last cached results (0 credits) instead of forcing a fresh execution.
 */
import { runQuery, getLatestResults, type DuneRow } from "../../dune/client";
import { CC_SECONDARY_QUERY_ID } from "../../dune/queryIds";
import { collectSales, type CollectionStats, type NormalizedSale } from "../../rarible/queries";
import { PLATFORM_SOURCES } from "../sources";
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
 * Build one platform's volume entry from a sale list. `spanDays` is how far back
 * the list reaches (30 for the CC Dune query, 1 for the 24h Rarille fetch) — we
 * only report 7d/30d aggregates the data actually covers.
 */
function buildPlatform(
  key: string,
  source: "dune" | "rarible",
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
    vol30dUsd: spanDays >= 30 ? sumUsd(allSales) : null,
    sales7dCount: spanDays >= 7 ? within(7).length : null,
    sales30dCount: spanDays >= 30 ? allSales.length : null,
  };
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
    const rows: DuneRow[] = opts.cachedOnly
      ? await getLatestResults(CC_SECONDARY_QUERY_ID)
      : await runQuery(CC_SECONDARY_QUERY_ID, { maxWaitMs: 480_000 });
    const ccSales: NormalizedSale[] = rows
      .map((r) => ({
        date: duneTimeToIso(r.block_time),
        tokenId: String(r.nft_mint ?? ""),
        buyer: String(r.buyer ?? ""),
        seller: String(r.seller ?? ""),
        priceUsd: num(r.price_usd),
      }))
      .filter((s) => s.priceUsd > 0 && s.tokenId);
    platforms["collector-crypt"] = buildPlatform("collector-crypt", "dune", ccSales, 30);
    log(
      `→ collector-crypt (Dune) ${ccSales.length} sales/30d · 24h $${Math.round(
        platforms["collector-crypt"].stats24h.volumeUsd,
      ).toLocaleString()} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
    );
  } catch (err) {
    log(`→ collector-crypt (Dune) FAILED: ${(err as Error).message}`);
  }

  // ── Beezie + Courtyard: Rarible (aggregates OpenSea), 24h ──
  for (const key of ["beezie", "courtyard"] as const) {
    const src = PLATFORM_SOURCES.find((p) => p.key === key);
    if (!src || src.kind !== "rarible") continue;
    try {
      const sales = await collectSales(src.collectionId, DAY);
      platforms[key] = buildPlatform(key, "rarible", sales, 1);
      log(
        `→ ${key} (Rarible) ${sales.length} sales/24h · $${Math.round(
          platforms[key].stats24h.volumeUsd,
        ).toLocaleString()}`,
      );
    } catch (err) {
      log(`→ ${key} (Rarible) FAILED: ${(err as Error).message}`);
    }
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
