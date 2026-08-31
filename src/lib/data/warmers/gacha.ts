/**
 * Gacha data warmer (core) — Dune backend → Postgres.
 *
 * Runs the per-platform Dune queries, transforms the rows, writes the snapshot
 * to the `snapshots` table (key='gacha') via writeGachaDune(), and records a
 * `source_freshness` row. Shared by both the CLI script
 * (scripts/warm-gacha-dune.ts) and the cron Route Handler
 * (app/api/cron/gacha/route.ts) so there is exactly one implementation.
 *
 * NOTE: big-hit enrichment uses getCCMetadataCachedOnly, which reads the CC
 * trait cache. Until that cache is migrated to Postgres (Phase 2), run this
 * where the trait data is available (locally, or post-Phase-2 anywhere) so the
 * Big Hits rail is populated. Core volumes/odds/buyback don't depend on it.
 */
import { runQuery, getResultsAutoRefresh, type DuneRow } from "../../dune/client";
import {
  GACHA_PLATFORMS,
  GACHA_LIVE_QUERY_ID,
  CC_ODDS_QUERY_ID,
  CC_BIG_HITS_QUERY_ID,
} from "../../dune/queryIds";
import { GACHA_ENABLED } from "../../flags";
import {
  readGachaDune,
  writeGachaDune,
  type GachaDunePlatform,
  type GachaPriceBucket,
  type GachaOddsTier,
  type GachaBigHit,
  type GachaDuneSnapshot,
} from "../gachaDuneCache";
import { getCCMetadataCachedOnly } from "../ccTraits";
import { normalizeTraits } from "../traits";

/** Rarity order, rarest → commonest, for display. */
const TIER_ORDER = ["SPrT", "LGND", "Epic", "High", "Mid", "Low"];

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Denoise gacha tiers. A real pack tier has repeat buyers; a one-off odd-dollar
// USDC send to the gacha wallet (e.g. $41,465 ×1) is not a pull — these pollute
// platforms with variable pricing (Phygitals) and inflate their totals (which
// sum over the tiers). Require a few pulls over 30d to count as a tier. CC/Beezie
// tiers are allowlist-filtered upstream, so this never touches their real tiers.
const MIN_TIER_PULLS = 3;

function buildOdds(rows: DuneRow[]): GachaOddsTier[] {
  const tiers = rows.map((r) => ({
    tier: String(r.tier),
    prizes24h: num(r.prizes_24h),
    prizes7d: num(r.prizes_7d),
    prizes30d: num(r.prizes_30d),
    pct: 0,
  }));
  const total7d = tiers.reduce((s, t) => s + t.prizes7d, 0);
  for (const t of tiers) t.pct = total7d > 0 ? t.prizes7d / total7d : 0;
  tiers.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
  return tiers;
}

function buildGachaPlatform(rows: DuneRow[]): GachaDunePlatform {
  const byPrice: GachaPriceBucket[] = rows
    .map((r) => ({
      price: num(r.pack_price),
      pulls24h: num(r.pulls_24h),
      vol24h: num(r.volume_24h),
      pulls7d: num(r.pulls_7d),
      vol7d: num(r.volume_7d),
      pulls30d: num(r.pulls_30d),
      vol30d: num(r.volume_30d),
    }))
    .filter((b) => b.price > 0 && b.pulls30d >= MIN_TIER_PULLS)
    .sort((a, b) => b.vol30d - a.vol30d);

  const sum = (sel: (b: GachaPriceBucket) => number) =>
    byPrice.reduce((s, b) => s + sel(b), 0);

  return {
    kind: "gacha",
    pulls24h: sum((b) => b.pulls24h),
    vol24h: sum((b) => b.vol24h),
    pulls7d: sum((b) => b.pulls7d),
    vol7d: sum((b) => b.vol7d),
    pulls30d: sum((b) => b.pulls30d),
    vol30d: sum((b) => b.vol30d),
    byPrice,
  };
}

// Courtyard's branch of the combined query returns a single AGGREGATE row (one
// count/volume per window, pack_price null), not the per-price-tier rows the
// other platforms give — so it has no `byPrice` breakdown. It IS gacha (pack
// pulls: ~23K/24h at a ~$64 avg, not variable-size vault deposits), just
// measured in aggregate. Classifying it "gacha" folds its ~$1.5M/24h into the
// homepage/platform Gacha lane instead of leaving it invisible under "Other
// primary" (the 6/25 ticket). Kept a separate builder because the row SHAPE
// differs; the empty byPrice is honestly surfaced downstream as "aggregate
// volume — per-pack odds not tracked yet".
//
// The standalone Courtyard query used to call these columns `txns_*`; the
// combined query normalises them to `pulls_*` so every branch shares one shape.
function buildAggregateGacha(rows: DuneRow[]): GachaDunePlatform {
  const r = rows[0] ?? {};
  return {
    kind: "gacha",
    pulls24h: num(r.pulls_24h),
    vol24h: num(r.volume_24h),
    pulls7d: num(r.pulls_7d),
    vol7d: num(r.volume_7d),
    pulls30d: num(r.pulls_30d),
    vol30d: num(r.volume_30d),
    byPrice: [],
  };
}

/** The buyback query's one-character platform codes (see queryIds). Only that
 *  query uses them; every other combined result still carries a full slug. */
const PLATFORM_BY_CODE: Record<string, string> = {
  c: "collector-crypt",
  p: "phygitals",
};

/** Split a combined multi-platform result set into per-platform row lists.
 *  Accepts either a `platform` slug or the buyback query's short `p` code — an
 *  unrecognised code drops the row rather than inventing a platform key. */
function splitByPlatform(rows: DuneRow[]): Map<string, DuneRow[]> {
  const by = new Map<string, DuneRow[]>();
  for (const r of rows) {
    const key = r.platform != null ? String(r.platform) : (PLATFORM_BY_CODE[String(r.p ?? "")] ?? "");
    if (!key) continue;
    const list = by.get(key);
    if (list) list.push(r);
    else by.set(key, [r]);
  }
  return by;
}

export type GachaWarmResult = {
  platforms: number;
  totalPlatforms: number;
  bigHits: number;
  topHitUsd: number;
  generatedAt: string;
  /** Provenance for the runWarmer freshness row. */
  rowsWritten?: number;
};

/**
 * Run the gacha warm: execute the Dune queries, build the snapshot, persist it
 * to Postgres. Freshness is recorded by the runWarmer wrapper at each entry point
 * (CLI script + cron route); a 0-platform result THROWS so that wrapper logs an
 * error row. Pass `cachedOnly` to read Dune's last cached results.
 *
 * Two of the four inputs are no longer fetched on every run, because Dune bills
 * per execution and nothing consumed them daily:
 *   • ODDS     — feeds only the /gacha page, which GACHA_ENABLED gates off.
 *   • BIG HITS — feeds only the weekly report; refreshed by `--big-hits` in the
 *                Monday job.
 * Both are CARRIED FORWARD from the previous snapshot when skipped. That matters:
 * this warmer rewrites the whole `gacha` blob, so simply not fetching them would
 * silently blank the Notable Pulls rail and the odds table.
 */
export async function runGachaWarm(
  opts: { cachedOnly?: boolean; bigHits?: boolean; log?: (msg: string) => void } = {},
): Promise<GachaWarmResult> {
  const log = opts.log ?? (() => {});
  // Previous snapshot — the carry-forward source for anything we skip below.
  const prev = await readGachaDune().catch(() => null);
  // Gacha queries are refreshed daily and move slowly; self-heal the cache only
  // once it's clearly missed a daily fresh run (so it can't rot like cc-secondary did).
  const GACHA_MAX_CACHE_AGE_MS = 26 * 60 * 60 * 1000;
  /** `reuse` opt-in returns NULL when Dune's cached result is one we already
   *  ingested — the caller must then carry its previous snapshot entry forward. */
  // ⚠️ 180s was calibrated for a healthy execution queue. An over-plan account
  // (Aug '26: 394% of included credits) gets deprioritized, and both daily
  // executions sat in the starved queue past 180s two days running — which
  // stopped CC/Phygitals gacha dailies and let the completeness gate freeze
  // every published Σ-chart. 600s rides out the throttle; the daily job's
  // 75-minute ceiling has room for both reads at the cap.
  const DUNE_EXEC_WAIT_MS = 600_000;
  const fetchRows = async (id: number, reuse = false): Promise<DuneRow[] | null> => {
    if (!opts.cachedOnly) return runQuery(id, { maxWaitMs: DUNE_EXEC_WAIT_MS });
    const r = await getResultsAutoRefresh(id, {
      maxAgeMs: GACHA_MAX_CACHE_AGE_MS,
      freshnessSource: "gacha-dune",
      reuseIfUnchanged: reuse,
      runOpts: { maxWaitMs: DUNE_EXEC_WAIT_MS },
    });
    if (r.refreshed) {
      const ageH = r.cachedAgeMs != null ? (r.cachedAgeMs / 3.6e6).toFixed(1) : "?";
      log(`  ↻ query ${id} cache stale (${ageH}h old) — self-healed with a fresh Dune run`);
    }
    return r.rows;
  };

  const platforms: Record<string, GachaDunePlatform> = {};

  // ONE execution for every platform's live windows; split on the `platform`
  // column. Was four separate queries — four executions for one fan-out scan.
  try {
    const t0 = Date.now();
    const liveRows = await fetchRows(GACHA_LIVE_QUERY_ID, true);
    if (liveRows === null) {
      // Unchanged since our last warm — rebuilding would produce identical
      // entries at full export price. Shallow-copy so the buyback assignment
      // below cannot mutate the previous snapshot in place.
      for (const key of GACHA_PLATFORMS) {
        const carried = prev?.platforms?.[key];
        if (carried) platforms[key] = { ...carried };
      }
      log(`→ gacha live — unchanged since our last warm, carried ${Object.keys(platforms).length} platform(s) forward (no download)`);
    } else {
    const byPlatform = splitByPlatform(liveRows);
    for (const key of GACHA_PLATFORMS) {
      const rows = byPlatform.get(key) ?? [];
      if (!rows.length) {
        log(`→ ${key} — no rows in the combined result (skipped)`);
        continue;
      }
      const platform =
        key === "courtyard" ? buildAggregateGacha(rows) : buildGachaPlatform(rows);
      platforms[key] = platform;
      log(
        `→ ${key} — 24h ${platform.pulls24h.toLocaleString()} pulls $${Math.round(platform.vol24h).toLocaleString()} · ${platform.byPrice.length} tiers`,
      );
    }
    log(`  (gacha live query ${GACHA_LIVE_QUERY_ID} · ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  } catch (err) {
    log(`→ gacha live (query ${GACHA_LIVE_QUERY_ID}) FAILED: ${(err as Error).message}`);
  }

  // Buyback — GONE FROM THIS WARMER, on purpose (Aug '26 credit crisis).
  //
  // This used to read the buyback query (8252735) daily to fill the blob's
  // `buyback` windows — but nothing ever consumed them: every visible buyback
  // figure (economics flows, R3 rate, net) is computed in fetchPlatform from
  // the SPINE series that warm-metric-snapshots writes. Meanwhile the query's
  // per-recipient export grew ~47K → ~241K rows with August's volume, so the
  // two readers were paying ~480 cr/day for one dataset — half of it for a
  // write-only field. warm-metric-snapshots is now the query's ONLY payer; the
  // blob's `buyback` field stays in the type for old snapshots but is never
  // written again. If a blob-level window is ever wanted back, derive it from
  // the spine (readMetricSeries) — do not re-add a second Dune read.

  // CC odds — realized rarity-tier distribution from prize deliveries. Only the
  // flag-gated /gacha page renders this, so while GACHA_ENABLED is off we carry
  // the last computed odds forward instead of paying for a daily execution.
  if (platforms["collector-crypt"]) {
    if (GACHA_ENABLED) {
      try {
        const rows = await fetchRows(CC_ODDS_QUERY_ID);
        // Never null: this does not opt into reuse.
        if (rows === null) throw new Error("cc-odds returned an unrequested reuse signal");
        const odds = buildOdds(rows);
        platforms["collector-crypt"].odds = odds;
        const top = odds.find((o) => o.tier === "SPrT") ?? odds[0];
        log(
          `→ collector-crypt odds (query ${CC_ODDS_QUERY_ID}) done — ${odds.length} tiers (SPrT ${(((top?.pct) ?? 0) * 100).toFixed(2)}%)`,
        );
      } catch (err) {
        log(`→ collector-crypt odds FAILED: ${(err as Error).message}`);
      }
    } else {
      const carried = prev?.platforms?.["collector-crypt"]?.odds;
      if (carried?.length) {
        platforms["collector-crypt"].odds = carried;
        log(`→ collector-crypt odds — carried forward (${carried.length} tiers; GACHA_ENABLED off)`);
      } else {
        log(`→ collector-crypt odds — skipped (GACHA_ENABLED off, nothing to carry forward)`);
      }
    }
  }

  // Big Hits — high-tier prize NFTs joined to local insured value (FMV). Only
  // the weekly report's Notable Pulls consumes this, so it refreshes weekly
  // (--big-hits in the Monday job) and is carried forward in between.
  let bigHits: GachaBigHit[] = [];
  if (!opts.bigHits) {
    bigHits = prev?.bigHits ?? [];
    log(`→ big hits — carried forward (${bigHits.length}; pass --big-hits to refresh)`);
  } else try {
    const rows = await fetchRows(CC_BIG_HITS_QUERY_ID);
    // Never null: this does not opt into reuse.
    if (rows === null) throw new Error("cc-big-hits returned an unrequested reuse signal");
    // Dedup by mint, keeping the most recent delivery (rows are time-desc).
    const seen = new Set<string>();
    const ordered: Array<{ mint: string; tier: string; at: string }> = [];
    for (const r of rows) {
      const mint = String(r.mint);
      if (seen.has(mint)) continue;
      seen.add(mint);
      ordered.push({ mint, tier: String(r.tier), at: String(r.block_time) });
    }
    const metas = await getCCMetadataCachedOnly(ordered.map((o) => o.mint));
    for (const o of ordered) {
      const meta = metas.get(o.mint);
      if (!meta) continue;
      const value = normalizeTraits(meta).insuredValueUsd ?? 0;
      if (value <= 0) continue;
      bigHits.push({
        platform: "collector-crypt",
        mint: o.mint,
        name: meta.name ?? o.mint.slice(0, 8),
        tier: o.tier,
        valueUsd: value,
        image: meta.image ?? null,
        imageFallback: (meta as { imageFallback?: string }).imageFallback ?? null,
        at: o.at,
      });
    }
    bigHits.sort((a, b) => b.valueUsd - a.valueUsd);
    bigHits = bigHits.slice(0, 15);
    log(`→ big hits (query ${CC_BIG_HITS_QUERY_ID}) done — top hit $${Math.round(bigHits[0]?.valueUsd ?? 0).toLocaleString()}`);
  } catch (err) {
    // Keep the previous hits rather than publishing an empty rail on a bad run.
    bigHits = prev?.bigHits ?? [];
    log(`→ big hits FAILED: ${(err as Error).message} — kept ${bigHits.length} previous`);
  }

  const snap: GachaDuneSnapshot = {
    generatedAt: new Date().toISOString(),
    platforms,
    bigHits,
  };
  await writeGachaDune(snap);

  const platformCount = Object.keys(platforms).length;
  // Soft-fail: every Dune platform query failed → throw so the runWarmer wrapper
  // records an "error" row (health gate) instead of leaving a silent 0-platform run.
  if (platformCount === 0) {
    throw new Error("gacha-dune: 0 platforms produced (all Dune queries failed)");
  }

  return {
    platforms: platformCount,
    totalPlatforms: GACHA_PLATFORMS.length,
    bigHits: bigHits.length,
    topHitUsd: bigHits[0]?.valueUsd ?? 0,
    generatedAt: snap.generatedAt,
    rowsWritten: platformCount,
  };
}
