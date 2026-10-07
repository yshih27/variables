/**
 * Core secondary-volume warmer — native feeds and Dune → Postgres.
 *
 * Produces the `core-volume` snapshot buckets.ts reads, so page renders make ZERO
 * request-time network calls. Per-platform secondary source:
 *   • collector-crypt → Dune CC_SECONDARY_QUERY_ID (on-chain; replaces Helius-429)
 *   • beezie          → its own /activity feed (api.beezie.com)
 *   • courtyard       → Rarible's activity index for the Courtyard collection
 *                       (OpenSea trades on Polygon). ⚠️ Measured 2026-09-22: the
 *                       Dune nft.trades query it replaced returned EXACTLY the
 *                       OpenSea rows Rarible indexes (194 in 30d, every row
 *                       `project = opensea`) at ~30 credits per execution and a
 *                       day of lag; Rarible returns them free, same-day. The
 *                       6/30 "no Rarible" directive was about Beezie, where the
 *                       aggregator inflated volume; for Courtyard it IS the
 *                       whole on-chain secondary picture. api.courtyard.io stays
 *                       WAF-blocked to servers.
 *   • dyli            → its own public /sales feed (marketplace lane only)
 *   • renaiss         → its own index API, read from the `renaiss_sales` and
 *                       `renaiss_pulls` row stores its two warmers fill (resale,
 *                       and pack spend as the gacha fields)
 *
 * Shared by the CLI (scripts/warm-core-dune.ts). Pass `cachedOnly` to read Dune's
 * last cached results (0 credits) instead of forcing a fresh execution.
 */
import { runQuery, getResultsAutoRefresh, type DuneRow } from "../../dune/client";
import { CC_SECONDARY_QUERY_ID } from "../../dune/queryIds";
import { PLATFORM_SOURCES } from "../sources";
import { cleanSecondarySales, formatHygiene } from "../secondaryHygiene";
import { readSecondarySalesSnapshot, writeSecondarySales } from "../secondarySalesCache";

// Self-heal a cached Dune secondary result older than this.
//
// ⚠️ MEASURED 2026-09-22 (billing period Sep 10 → Oct 10): at 12h this fired on
// EVERY ~04:00 core run — the daily batch's fresh executions land ~10:00 UTC
// (the 05:30 cron drifts), so by 04:00 the cache was 17–18h old, both
// secondary query (7675297) re-executed "stale", and the daily run
// executed them AGAIN six hours later. Two executions a day bought nothing and
// cost ~55–60 credits a day, a fifth of the whole burn (~290 cr/day against
// 4,000 included). 26h clears every cached run between one daily execution and
// the next; the safety it was there for survives: if the daily batch fails, the
// first cached run past 26h still self-heals, one day late instead of six hours.
const CC_SECONDARY_MAX_CACHE_AGE_MS = 26 * 60 * 60 * 1000;
import { collectSaleActivities, type CollectionStats, type NormalizedSale } from "../../rarible/queries";
import type { RaribleSellActivity } from "../../rarible/types";
import { fetchBeezieSaleRows } from "../../beezie/market";
import {
  storedFromBeezie,
  storedFromCC,
  storedFromCourtyard,
  writeSalesStore,
  type ObservedSale,
  type StoredSecondarySale,
} from "../salesStore";
import { fetchDyliLaneWindows } from "../../dyli/sales";
import { readRenaissSales } from "../../renaiss/sales";
import { SALES_TABLE_MIN } from "../coreVolumeCache";
import { packWindows, readPackSpend } from "../../renaiss/pulls";
import { feedIsCurrent, readRenaissFeeds } from "../../renaiss/feedState";
import {
  readCoreVolume,
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
export function buildPlatform(
  key: string,
  source: CorePlatformVolume["source"],
  allSales: NormalizedSale[],
  spanDays: number,
): CorePlatformVolume {
  const now = Date.now();
  const within = (days: number) =>
    allSales.filter((s) => new Date(s.date).getTime() > now - days * DAY);
  const sumUsd = (xs: NormalizedSale[]) => xs.reduce((s, x) => s + x.priceUsd, 0);

  const s24 = within(1).sort((a, b) => b.date.localeCompare(a.date));
  // A thin 24h: carry the week too, for the platform page's tables (fetchPlatform).
  const s7 = s24.length < SALES_TABLE_MIN && spanDays >= 7 ? within(7).sort((a, b) => b.date.localeCompare(a.date)) : null;
  return {
    source,
    stats24h: statsFromSaleList(key, s24),
    sales24h: s24,
    ...(s7 ? { sales7d: s7 } : {}),
    vol7dUsd: spanDays >= 7 ? sumUsd(within(7)) : null,
    vol30dUsd: spanDays >= 30 ? sumUsd(within(30)) : null,
    sales7dCount: spanDays >= 7 ? within(7).length : null,
    sales30dCount: spanDays >= 30 ? within(30).length : null,
  };
}

/**
 * Fetch sale-level rows `{ block_time, price_usd, nft_mint, buyer, seller }` from a
 * Dune secondary-sales query → NormalizedSale[]. `cachedOnly` does a self-healing
 * cached read (a stale cache triggers a fresh run). Both feeds are windowed to 30d
 * on the Dune side; `maxRows` stays generous purely as a headroom guard.
 */
/** The secondary window: Dune 7675297 scans `block_time > now() - interval '30' day`; the Courtyard Rarible read uses the same 30 days. */
export const SECONDARY_WINDOW_DAYS = 30;

export type SecondaryScan<Raw = unknown> = {
  /** The hygiene-cleaned sales every reader takes. */
  sales: NormalizedSale[];
  /** The same feed BEFORE hygiene, each sale with its feed row — what the
   *  `secondary_sales` store keeps (hygiene runs at read). */
  observed: ObservedSale<Raw>[];
  /** When Dune computed the rows (AutoRefreshResult.executionEndedAt; a fresh
   *  execution reports now). Null only when Dune omitted it — then a caller
   *  must not infer that a day with no rows was scanned. */
  executionEndedAt: string | null;
  windowDays: number;
};

/**
 * The scan behind `fetchDuneSecondarySales`, with its coverage. A windowed query
 * that returns no row for a day has MEASURED that day as zero — the spine writer
 * needs the execution time to tell that zero from "not scanned yet".
 */
async function fetchDuneSecondaryScan(
  queryId: number,
  label: string,
  opts: { cachedOnly?: boolean; reuseIfUnchanged?: boolean; log?: (msg: string) => void } = {},
): Promise<SecondaryScan<DuneRow> | null> {
  let rows: DuneRow[];
  let executionEndedAt: string | null = null;
  if (opts.cachedOnly) {
    const r = await getResultsAutoRefresh(queryId, {
      maxAgeMs: CC_SECONDARY_MAX_CACHE_AGE_MS,
      freshnessSource: "core-volume",
      // Opt-in: only a caller that can carry its previous entry forward may ask
      // for this. The spine and backfill need the rows themselves, so they don't.
      reuseIfUnchanged: opts.reuseIfUnchanged === true,
      runOpts: { maxWaitMs: 480_000, maxRows: 250_000 },
      maxRows: 250_000,
    });
    // NULL = we already ingested this exact execution. The caller keeps the
    // platform entry it wrote last run rather than re-deriving identical output.
    if (r.rows === null) return null; // only reachable when reuseIfUnchanged was set
    rows = r.rows;
    executionEndedAt = r.executionEndedAt;
    if (r.refreshed) {
      const ageH = r.cachedAgeMs != null ? (r.cachedAgeMs / 3.6e6).toFixed(1) : "?";
      (opts.log ?? console.log)(`  ↻ ${label} cache stale (${ageH}h old) — self-healed with a fresh Dune run`);
    }
  } else {
    rows = await runQuery(queryId, { maxWaitMs: 480_000, maxRows: 250_000 });
    executionEndedAt = new Date().toISOString();
  }
  const observed: ObservedSale<DuneRow>[] = [];
  for (const raw of rows) {
    const sale = ccSaleOf(raw);
    if (sale) observed.push({ sale, raw });
  }
  // D10-1: strip fan-out dupes, self-trades, and ring-wash at the source, so every
  // downstream reader (core volume, spine, trending, sale panel / price index,
  // getCardSales) sees the same clean feed. See secondaryHygiene.ts.
  const { sales, stats } = cleanSecondarySales(observed.map((o) => o.sale));
  const line = formatHygiene(label, stats);
  if (line) (opts.log ?? console.log)(line);
  return { sales, observed, executionEndedAt, windowDays: SECONDARY_WINDOW_DAYS };
}

/**
 * One row of Dune query 7675297 → a sale, or null without a positive price or
 * a mint. Pure, so the `secondary_sales` store's tests and the feed share it.
 */
export function ccSaleOf(r: DuneRow): NormalizedSale | null {
  const sale = {
    date: duneTimeToIso(r.block_time),
    tokenId: String(r.nft_mint ?? ""),
    buyer: String(r.buyer ?? ""),
    seller: String(r.seller ?? ""),
    priceUsd: num(r.price_usd),
  };
  return sale.priceUsd > 0 && sale.tokenId ? sale : null;
}

async function fetchDuneSecondarySales(
  queryId: number,
  label: string,
  opts: { cachedOnly?: boolean; reuseIfUnchanged?: boolean; log?: (msg: string) => void } = {},
): Promise<NormalizedSale[] | null> {
  const scan = await fetchDuneSecondaryScan(queryId, label, opts);
  return scan ? scan.sales : null;
}

async function mustHaveScan<Raw>(p: Promise<SecondaryScan<Raw> | null>): Promise<SecondaryScan<Raw>> {
  const scan = await p;
  if (scan === null) throw new Error("dune secondary feed returned an unrequested reuse signal");
  return scan;
}

/** CC secondary sales with the scan's coverage — the spine writer's read. */
export async function fetchCCSecondaryScan(
  opts: { cachedOnly?: boolean; log?: (msg: string) => void } = {},
): Promise<SecondaryScan<DuneRow>> {
  return mustHaveScan(fetchDuneSecondaryScan(CC_SECONDARY_QUERY_ID, "cc-secondary", opts));
}

export const COURTYARD_COLLECTION = (() => {
  const src = PLATFORM_SOURCES.find((p) => p.key === "courtyard");
  return src && "collectionId" in src ? src.collectionId : "POLYGON:0x251be3a17af4892035c37ebf5890f4a4d889dcad";
})();

/**
 * Courtyard secondary sales with the scan's coverage — the spine writer's read.
 * A live Rarible read: free, no cache to be stale, so `cachedOnly` is accepted
 * and ignored and the scan is covered through now. The same hygiene pass as the
 * Dune feeds (wash, self-trades, sweeps).
 */
export async function fetchCourtyardSecondaryScan(
  opts: { cachedOnly?: boolean; log?: (msg: string) => void } = {},
): Promise<SecondaryScan<RaribleSellActivity>> {
  const observed = await collectSaleActivities(COURTYARD_COLLECTION, SECONDARY_WINDOW_DAYS * DAY);
  const { sales, stats } = cleanSecondarySales(observed.map((o) => o.sale));
  const line = formatHygiene("courtyard-secondary", stats);
  if (line) (opts.log ?? console.log)(line);
  return { sales, observed, executionEndedAt: new Date().toISOString(), windowDays: SECONDARY_WINDOW_DAYS };
}

/**
 * The exported wrappers never request reuse, so a null is unreachable — but the
 * type allows it, and turning that into a silent `[]` is exactly how an empty
 * feed becomes a hollow snapshot. Fail loudly instead.
 */
async function mustHaveRows(p: Promise<NormalizedSale[] | null>): Promise<NormalizedSale[]> {
  const rows = await p;
  if (rows === null) throw new Error("dune secondary feed returned an unrequested reuse signal");
  return rows;
}

/** CC secondary sales (Dune). Shared by the core warmer, the spine, and backfill. */
export async function fetchCCSecondarySales(
  opts: { cachedOnly?: boolean; reuseIfUnchanged?: boolean; log?: (msg: string) => void } = {},
): Promise<NormalizedSale[]> {
  return mustHaveRows(fetchDuneSecondarySales(CC_SECONDARY_QUERY_ID, "cc-secondary", opts));
}

/** Courtyard secondary sales (Rarible activity index, 30d). Shared by the core warmer, the spine, and backfill. */
export async function fetchCourtyardSecondarySales(
  opts: { cachedOnly?: boolean; reuseIfUnchanged?: boolean; log?: (msg: string) => void } = {},
): Promise<NormalizedSale[]> {
  return (await fetchCourtyardSecondaryScan(opts)).sales;
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
  // Previous snapshot — the carry-forward source when a Dune leg reports that
  // its cached result is one we already ingested. Re-deriving it would produce a
  // byte-identical entry at full export price.
  const prev = await readCoreVolume().catch(() => null);
  const carryForward = (key: string, label: string): void => {
    const carried = prev?.platforms?.[key];
    if (carried) {
      platforms[key] = carried;
      log(`→ ${label} — unchanged since our last warm, carried forward (no download)`);
    } else {
      log(`→ ${label} — unchanged but no previous entry to carry forward (skipped)`);
    }
  };

  // Row-level feeds captured for the app-side store write below; null = leg
  // carried forward (stored rows still current) or failed (keep previous rows).
  let ccRowsForStore: NormalizedSale[] | null = null;
  let courtyardRowsForStore: NormalizedSale[] | null = null;
  // Every row the legs fetched, before hygiene, for the `secondary_sales` store
  // (salesStore.ts). No request is added for it: these are the rows above.
  const kept: StoredSecondarySale[] = [];

  // ── Collector Crypt: Dune (full chain scan, no Helius 429) ──
  try {
    const t0 = Date.now();
    const ccScan = await fetchDuneSecondaryScan(CC_SECONDARY_QUERY_ID, "cc-secondary", { ...opts, reuseIfUnchanged: true });
    if (ccScan === null) {
      carryForward("collector-crypt", "collector-crypt (Dune)");
    } else {
      const ccSales = ccScan.sales;
      ccRowsForStore = ccSales;
      kept.push(...ccScan.observed.map((o) => storedFromCC(o)));
      platforms["collector-crypt"] = buildPlatform("collector-crypt", "dune", ccSales, 30);
      log(
        `→ collector-crypt (Dune) ${ccSales.length} sales/30d · 24h $${Math.round(
          platforms["collector-crypt"].stats24h.volumeUsd,
        ).toLocaleString()} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
      );
    }
  } catch (err) {
    log(`→ collector-crypt (Dune) FAILED: ${(err as Error).message}`);
  }

  // ── Beezie: its OWN /activity feed (no Rarible quota dependency). Reaches
  //    back months, so we get real 7d/30d too. This is the fix for the Pokémon
  //    $0 — Rarible's 429 used to drop Beezie sales entirely. ──
  try {
    const t0 = Date.now();
    const rows = await fetchBeezieSaleRows(30 * DAY);
    const sales = rows.map((r) => r.sale);
    kept.push(...rows.map(storedFromBeezie));
    platforms["beezie"] = buildPlatform("beezie", "beezie", sales, 30);
    log(
      `→ beezie (Beezie /activity) ${sales.length} sales/30d · 24h $${Math.round(
        platforms["beezie"].stats24h.volumeUsd,
      ).toLocaleString()} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
    );
  } catch (err) {
    log(`→ beezie (Beezie /activity) FAILED: ${(err as Error).message}`);
  }

  // ── Courtyard: Rarible's activity index (OpenSea trades of the collection on
  //    Polygon), 30d, live and free — see the header. A failed read leaves the
  //    previous snapshot's entry in place through `carryForward`. ──
  try {
    const t0 = Date.now();
    const scan = await fetchCourtyardSecondaryScan({ log });
    const sales = scan.sales;
    courtyardRowsForStore = sales;
    kept.push(...scan.observed.map(storedFromCourtyard));
    platforms["courtyard"] = buildPlatform("courtyard", "rarible", sales, 30);
    log(
      `→ courtyard (Rarible activity) ${sales.length} sales · 24h $${Math.round(
        platforms["courtyard"].stats24h.volumeUsd,
      ).toLocaleString()} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
    );
  } catch (err) {
    log(`→ courtyard (Rarible activity) FAILED: ${(err as Error).message}`);
    carryForward("courtyard", "courtyard (Rarible activity)");
  }

  // ── Persist the row-level Dune feeds for APP-SIDE readers ──────────────────
  // Card pages, trending and the report used to re-read these feeds from Dune
  // themselves — ~5.6 cr per cold read at Analyst's 10 cr/MB, and a production
  // deploy makes EVERY card token cold at once (measured Aug 28: +11.4 cr for
  // two card-page renders, +5.7 for one organic view). This warm already holds
  // the cleaned rows, so it writes them into the platform-keyed secondary-sales
  // store (Beezie's existing pattern) and the app reads Postgres for free.
  // Carried-forward / failed legs skip their key — the stored rows are still
  // the newest we have.
  if (ccRowsForStore || courtyardRowsForStore) {
    try {
      const cur = (await readSecondarySalesSnapshot()) ?? {
        generatedAt: "",
        windowDays: 30,
        platforms: {},
      };
      if (ccRowsForStore) cur.platforms["collector-crypt"] = ccRowsForStore;
      if (courtyardRowsForStore) cur.platforms["courtyard"] = courtyardRowsForStore;
      cur.generatedAt = new Date().toISOString();
      await writeSecondarySales(cur);
      log(
        `→ secondary-sales store updated · cc ${ccRowsForStore ? ccRowsForStore.length : "carried"} · courtyard ${courtyardRowsForStore ? courtyardRowsForStore.length : "carried"}`,
      );
    } catch (err) {
      log(`→ secondary-sales store write FAILED (app readers keep previous rows): ${(err as Error).message}`);
    }
  }

  // ── Keep every fetched row in `secondary_sales` (salesStore.ts) ─────────────
  // The snapshot above is a 30-day window each run overwrites; the store keeps
  // what ages out of it. Idempotent upserts on the feed's own key, rows before
  // hygiene. Never fails the run: a store error is logged and the volumes stand.
  log(`→ ${await writeSalesStore(kept)}`);

  // ── DYLI: its own public sales feed, already paged into `dyli_sales` by
  //    warm-dyli-sales. Only the MARKETPLACE lane belongs in core-volume —
  //    gacha and direct rows are first sales and are published through their own
  //    spine metrics, never folded into secondary volume (see dyli/lanes.ts). ──
  try {
    const t0 = Date.now();
    const w = await fetchDyliLaneWindows(30 * DAY);
    platforms["dyli"] = buildPlatform("dyli", "dyli", w.marketplace, 30);
    // DYLI's gacha rides the same feed, so it is carried here rather than in the
    // Dune gacha snapshot (which has no DYLI entry and never will — DYLI is not
    // a Dune source). Rolling windows, matching every other platform's basis.
    platforms["dyli"].gachaVol24Usd = w.gachaVol24Usd;
    platforms["dyli"].gachaVol7Usd = w.gachaVol7Usd;
    platforms["dyli"].gachaSales24h = w.gachaSales24h;
    log(
      `→ dyli (native /sales) ${w.marketplace.length} secondary sales/30d · 24h $${Math.round(
        platforms["dyli"].stats24h.volumeUsd,
      ).toLocaleString()} · gacha 24h $${Math.round(w.gachaVol24Usd).toLocaleString()} / 7d $${Math.round(
        w.gachaVol7Usd,
      ).toLocaleString()} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
    );
  } catch (err) {
    log(`→ dyli (native /sales) FAILED: ${(err as Error).message}`);
  }

  // ── Renaiss: its own index API, paged into `renaiss_sales` (resale) and
  //    `renaiss_pulls` (packs) by warm-renaiss-sales / warm-renaiss-pulls. The core
  //    batch runs those beside the DYLI step, after this one, so this reads the
  //    previous batch's writes, as the DYLI entry above does. Resale goes through
  //    the same hygiene as every feed (readRenaissSales).
  //    ⚠️ ONLY WHILE THE FEED IS CURRENT: a store that stopped filling (no key
  //    yet, a failed run, a backfill still under way) would read as a quiet 24h,
  //    so unless its last run reached the present within 12h the entry is left
  //    out and the board shows "—", never $0. The pack figures follow the same
  //    rule on the pulls feed. ──
  try {
    const t0 = Date.now();
    const feeds = (await readRenaissFeeds())?.feeds ?? {};
    if (!feedIsCurrent(feeds.sales)) {
      log(`→ renaiss (native index API) left out: its sales feed last reached the present ${feeds.sales?.caughtUpAt ?? "never"}`);
    } else {
      const { sales, stats } = await readRenaissSales({ sinceMs: Date.now() - 30 * DAY });
      const line = formatHygiene("renaiss-secondary", stats);
      if (line) log(line);
      platforms["renaiss"] = buildPlatform("renaiss", "renaiss", sales, 30);
      let packs = "packs left out (the pulls feed is not current)";
      if (feedIsCurrent(feeds.pulls)) {
        const w = packWindows(await readPackSpend(new Date(Date.now() - 7 * DAY).toISOString()));
        platforms["renaiss"].gachaVol24Usd = w.gachaVol24Usd;
        platforms["renaiss"].gachaVol7Usd = w.gachaVol7Usd;
        platforms["renaiss"].gachaSales24h = w.gachaSales24h;
        packs = `packs 24h $${Math.round(w.gachaVol24Usd).toLocaleString()} / 7d $${Math.round(w.gachaVol7Usd).toLocaleString()}`;
      }
      log(
        `→ renaiss (native index API) ${sales.length} resale sales/30d · 24h $${Math.round(
          platforms["renaiss"].stats24h.volumeUsd,
        ).toLocaleString()} · ${packs} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
      );
    }
  } catch (err) {
    log(`→ renaiss (native index API) FAILED: ${(err as Error).message}`);
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
