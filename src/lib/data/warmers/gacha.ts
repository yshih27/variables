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
  BUYBACK_PLATFORMS,
  BUYBACK_QUERY_ID,
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

/**
 * Sum day-bucketed rows over trailing N COMPLETE UTC days, for each N requested.
 * Today's bucket is always excluded: it is still filling, so including it would
 * understate every window and make a "24h" number depend on what time the warmer
 * happened to run. `days` reports how many buckets actually landed in the window,
 * so a gap is visible rather than silently summing to a smaller number.
 */
function sumTrailingCompleteDays(
  rows: DuneRow[],
  windows: number[],
): Record<number, { usd: number; count: number; days: number }> {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const todayUtc = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  const out: Record<number, { usd: number; count: number; days: number }> = {};
  // Distinct days, not row count — per-recipient rows put many rows on one day.
  const seenDays: Record<number, Set<number>> = {};
  for (const n of windows) {
    out[n] = { usd: 0, count: 0, days: 0 };
    seenDays[n] = new Set();
  }
  for (const r of rows) {
    // ⚠️ TWO ROW SHAPES. Since the R3 switchover the buyback query returns one
    // row per RECIPIENT per day as `{d, w, n, u}`; before it, one row per day as
    // `{day, payout_usd, buyback_count}`. Summing per-recipient rows across a
    // window gives the same day totals, so the windows below are unchanged in
    // meaning — but the field names are not, and reading the old ones off the new
    // shape yields a silent 0 (num() coerces undefined to 0), which would publish
    // a zero payout and a 100% house take. Hence the explicit fallback.
    const raw = String((r.d ?? r.day) ?? "");
    const t = Date.parse(raw.includes("T") ? raw : raw.replace(" UTC", "Z").replace(" ", "T"));
    if (!Number.isFinite(t)) continue;
    const age = Math.round((todayUtc - t) / DAY_MS); // 0 = today (partial), 1 = yesterday
    if (age < 1) continue;
    for (const n of windows) {
      if (age <= n) {
        out[n].usd += num(r.u ?? r.payout_usd);
        out[n].count += num(r.n ?? r.buyback_count);
        seenDays[n].add(t);
      }
    }
  }
  for (const n of windows) out[n].days = seenDays[n].size;
  return out;
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
  const fetchRows = async (id: number, reuse = false): Promise<DuneRow[] | null> => {
    if (!opts.cachedOnly) return runQuery(id, { maxWaitMs: 180_000 });
    const r = await getResultsAutoRefresh(id, {
      maxAgeMs: GACHA_MAX_CACHE_AGE_MS,
      freshnessSource: "gacha-dune",
      reuseIfUnchanged: reuse,
      runOpts: { maxWaitMs: 180_000 },
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

  // Buyback — USDC paid back to players who instantly cashed out.
  //
  // ⚠️ The 6h batch does NOT read this query. Since R3 it is a per-recipient
  // export (~47k rows, ~1.75MB, ~17.5 cr) that changes at most once a day, and
  // the 6h path was re-downloading it four times daily for numbers that could
  // not have moved. Our own snapshot is ≤24h old by construction — it is written
  // by the daily fresh run — so the 6h batch carries it forward and only the
  // daily job pays for the export.
  if (opts.cachedOnly) {
    for (const key of BUYBACK_PLATFORMS) {
      const target = platforms[key];
      const carried = prev?.platforms?.[key]?.buyback;
      if (!target) continue;
      if (carried) {
        target.buyback = carried;
      } else {
        log(`→ ${key} buyback — no previous snapshot to carry forward (left unset)`);
      }
    }
    log(`→ buyback — carried forward from our snapshot (6h batch does not read query ${BUYBACK_QUERY_ID})`);
  } else try {
    const bbRows = await fetchRows(BUYBACK_QUERY_ID);
    if (bbRows === null) throw new Error("buyback returned an unrequested reuse signal");
    const byPlatform = splitByPlatform(bbRows);
    for (const key of BUYBACK_PLATFORMS) {
      const target = platforms[key];
      if (!target) continue;
      const rows = byPlatform.get(key) ?? [];
      if (!rows.length) {
        log(`→ ${key} buyback — no rows in the combined result (skipped)`);
        continue;
      }
      // The query is day-bucketed now, so the rolling windows it used to return
      // are derived here as trailing COMPLETE-day sums. Today's bucket is still
      // filling and is excluded — a partial day would understate every window and
      // make the 24h figure swing with the hour of the warm.
      const w = sumTrailingCompleteDays(rows, [1, 7, 30]);
      target.buyback = {
        payout24h: w[1].usd,
        payout7d: w[7].usd,
        payout30d: w[30].usd,
        count24h: w[1].count,
        count7d: w[7].count,
        count30d: w[30].count,
      };
      // Deliberately NOT printing a net/take here: vol7d comes from the live
      // gacha query's ROLLING 7d window, while this payout is 7 complete calendar
      // days. Subtracting them would be the mismatched-window error the whole
      // shape change exists to avoid. Net revenue is computed in fetchPlatform
      // from the spine, where both sides are daily and identically gated.
      log(
        `→ ${key} buyback — ${w[30].days}d of ${rows.length} buckets · 7d $${Math.round(w[7].usd).toLocaleString()} (${w[7].count.toLocaleString()} payouts)`,
      );
    }
  } catch (err) {
    log(`→ buyback (query ${BUYBACK_QUERY_ID}) FAILED: ${(err as Error).message}`);
  }

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
