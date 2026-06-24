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
  GACHA_QUERY_IDS,
  CC_ODDS_QUERY_ID,
  CC_BIG_HITS_QUERY_ID,
  BUYBACK_QUERY_IDS,
} from "../../dune/queryIds";
import {
  writeGachaDune,
  type GachaDunePlatform,
  type GachaPriceBucket,
  type GachaOddsTier,
  type GachaBigHit,
  type GachaDuneSnapshot,
} from "../gachaDuneCache";
import { getCCMetadataCachedOnly } from "../ccTraits";
import { normalizeTraits } from "../traits";
import { recordFreshness } from "../../db/freshness";

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

function buildTokenization(rows: DuneRow[]): GachaDunePlatform {
  const r = rows[0] ?? {};
  return {
    kind: "tokenization",
    pulls24h: num(r.txns_24h),
    vol24h: num(r.volume_24h),
    pulls7d: num(r.txns_7d),
    vol7d: num(r.volume_7d),
    pulls30d: num(r.txns_30d),
    vol30d: num(r.volume_30d),
    byPrice: [],
  };
}

export type GachaWarmResult = {
  platforms: number;
  totalPlatforms: number;
  bigHits: number;
  topHitUsd: number;
  generatedAt: string;
};

/**
 * Run the gacha warm: execute the Dune queries, build the snapshot, persist it
 * to Postgres, and record freshness. Pass `cachedOnly` to read Dune's last
 * cached results (zero credits) instead of forcing fresh executions.
 */
export async function runGachaWarm(
  opts: { cachedOnly?: boolean; log?: (msg: string) => void } = {},
): Promise<GachaWarmResult> {
  const log = opts.log ?? (() => {});
  const startedAt = Date.now();
  // Gacha queries are refreshed daily and move slowly; self-heal the cache only
  // once it's clearly missed a daily fresh run (so it can't rot like cc-secondary did).
  const GACHA_MAX_CACHE_AGE_MS = 26 * 60 * 60 * 1000;
  const fetchRows = async (id: number): Promise<DuneRow[]> => {
    if (!opts.cachedOnly) return runQuery(id, { maxWaitMs: 180_000 });
    const r = await getResultsAutoRefresh(id, {
      maxAgeMs: GACHA_MAX_CACHE_AGE_MS,
      runOpts: { maxWaitMs: 180_000 },
    });
    if (r.refreshed) {
      const ageH = r.cachedAgeMs != null ? (r.cachedAgeMs / 3.6e6).toFixed(1) : "?";
      log(`  ↻ query ${id} cache stale (${ageH}h old) — self-healed with a fresh Dune run`);
    }
    return r.rows;
  };

  const platforms: Record<string, GachaDunePlatform> = {};

  for (const [key, queryId] of Object.entries(GACHA_QUERY_IDS)) {
    const t0 = Date.now();
    try {
      const rows = await fetchRows(queryId);
      const platform =
        key === "courtyard" ? buildTokenization(rows) : buildGachaPlatform(rows);
      platforms[key] = platform;
      const dt = ((Date.now() - t0) / 1000).toFixed(0);
      log(
        `→ ${key} (query ${queryId}) done in ${dt}s — 24h ${platform.pulls24h.toLocaleString()} ${platform.kind === "gacha" ? "pulls" : "txns"} $${Math.round(platform.vol24h).toLocaleString()} · ${platform.byPrice.length} tiers`,
      );
    } catch (err) {
      log(`→ ${key} (query ${queryId}) FAILED: ${(err as Error).message}`);
    }
  }

  // Buyback — USDC paid back to players who instantly cashed out.
  for (const [key, queryId] of Object.entries(BUYBACK_QUERY_IDS)) {
    if (!platforms[key]) continue;
    try {
      const rows = await fetchRows(queryId);
      const r = rows[0] ?? {};
      platforms[key].buyback = {
        payout24h: num(r.pay_24h),
        payout7d: num(r.pay_7d),
        payout30d: num(r.pay_30d),
        count24h: num(r.bb_24h),
        count7d: num(r.bb_7d),
        count30d: num(r.bb_30d),
      };
      const net = platforms[key].vol7d - num(r.pay_7d);
      const take = platforms[key].vol7d > 0 ? (100 * net) / platforms[key].vol7d : 0;
      log(
        `→ ${key} buyback (query ${queryId}) done — net 7d $${Math.round(net).toLocaleString()} (${take.toFixed(1)}% take)`,
      );
    } catch (err) {
      log(`→ ${key} buyback (query ${queryId}) FAILED: ${(err as Error).message}`);
    }
  }

  // CC odds — realized rarity-tier distribution from prize deliveries.
  if (platforms["collector-crypt"]) {
    try {
      const rows = await fetchRows(CC_ODDS_QUERY_ID);
      const odds = buildOdds(rows);
      platforms["collector-crypt"].odds = odds;
      const top = odds.find((o) => o.tier === "SPrT") ?? odds[0];
      log(
        `→ collector-crypt odds (query ${CC_ODDS_QUERY_ID}) done — ${odds.length} tiers (SPrT ${(((top?.pct) ?? 0) * 100).toFixed(2)}%)`,
      );
    } catch (err) {
      log(`→ collector-crypt odds FAILED: ${(err as Error).message}`);
    }
  }

  // Big Hits — high-tier prize NFTs joined to local insured value (FMV).
  let bigHits: GachaBigHit[] = [];
  try {
    const rows = await fetchRows(CC_BIG_HITS_QUERY_ID);
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
    log(`→ big hits FAILED: ${(err as Error).message}`);
  }

  const snap: GachaDuneSnapshot = {
    generatedAt: new Date().toISOString(),
    platforms,
    bigHits,
  };
  await writeGachaDune(snap);

  const result: GachaWarmResult = {
    platforms: Object.keys(platforms).length,
    totalPlatforms: Object.keys(GACHA_QUERY_IDS).length,
    bigHits: bigHits.length,
    topHitUsd: bigHits[0]?.valueUsd ?? 0,
    generatedAt: snap.generatedAt,
  };

  await recordFreshness("gacha-dune", {
    status: result.platforms > 0 ? "ok" : "error",
    rowsWritten: result.platforms,
    durationMs: Date.now() - startedAt,
    generatedAt: snap.generatedAt,
  });

  return result;
}
