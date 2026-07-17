import { unstable_cache } from "next/cache";
import { NavBar } from "@/components/NavBar";
import { IndexStudio } from "@/components/IndexStudio";
import { OverviewMetricColumn, type OverviewMetricRow } from "@/components/OverviewMetricColumn";
import { MetricBarCard } from "@/components/MetricBarCard";
import { PlatformStatBar } from "@/components/PlatformStatBar";
import { PlatformTable } from "@/components/PlatformTable";
import { fetchHomepage } from "@/lib/data/fetchHomepage";
import { readMetricSeriesBulk, type SeriesPoint } from "@/lib/data/metricSnapshots";
import { totalActivity24, sharePct24 } from "@/lib/platform/share";
import { formatCompactUsd } from "@/lib/format";

const getData = unstable_cache(async () => fetchHomepage(), ["platforms-fulllist:v6"], {
  revalidate: 3600,
  tags: ["homepage"],
});

/** Per-entity daily spine series (keyed by metric) for the whole platform family.
 *  v2 (R5-1): v1 cached an empty `mcap_usd` map from before the spine carried
 *  per-platform market cap. */
const getPlatformSeries = unstable_cache(
  async (metric: string) => Object.fromEntries(await readMetricSeriesBulk("platform", metric)),
  ["platforms-series:v2"],
  { revalidate: 3600, tags: ["homepage"] },
);

/** One platform's daily TOTAL — its marketplace and gacha series added per day.
 *  Mirrors the total24Usd the rail and table rank by, so the card under a
 *  platform's name measures the same thing its row does. Non-finite points are
 *  skipped rather than zeroed: a day with no reading isn't a day worth $0, and
 *  MetricBarCard now lays points into true day slots, so an absent day stays
 *  absent instead of drawing a false floor. */
function totalDaily(...sources: (SeriesPoint[] | undefined)[]): SeriesPoint[] {
  const byTs = new Map<string, number>();
  for (const series of sources) {
    for (const p of series ?? []) {
      if (!Number.isFinite(p.value)) continue;
      byTs.set(p.ts, (byTs.get(p.ts) ?? 0) + p.value);
    }
  }
  return [...byTs.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([ts, value]) => ({ ts, value }));
}

// ISR: cached HTML, 30-min background revalidate (data changes every ~6h) — R2-B1.
// All reads are unstable_cache-backed; no cookies/headers/searchParams here.
export const revalidate = 1800;

export const metadata = {
  title: "Platforms Overview · VARIBLE",
  description:
    "Where the trading happens — tokenized-collectible platforms compared on 24h volume, the marketplace/gacha split, and market cap.",
};

export default async function AllPlatformsPage() {
  const [data, mktSeries, gachaSeries] = await Promise.all([
    getData(),
    getPlatformSeries("volume_usd"),
    getPlatformSeries("gacha_volume_usd"),
  ]);

  const last14 = (s: SeriesPoint[]) => s.slice(-14);

  // Rank by TOTAL 24h activity — the same order, and the same Σ, that
  // PlatformTable sorts and divides by, so the leaderboard, the ribbon's
  // DOMINANCE and the table's Share column can't disagree inside one fold.
  const total24 = totalActivity24(data.platforms);
  const ranked = [...data.platforms].sort(
    (a, b) => (b.total24Usd > 0 ? b.total24Usd : 0) - (a.total24Usd > 0 ? a.total24Usd : 0),
  );

  // ── Zone 1: the rail is a LEADERBOARD ───────────────────────────────────────
  // One row per platform, so every line of the fold names a platform. The old
  // rail's aggregates (Total/Marketplace/Gacha 24h) are gone from this page —
  // they describe the market, which is /ips's subject — and Top Platform /
  // Platforms Tracked / HHI moved up into the ribbon rather than being said
  // twice.
  //
  // ⚠️ pct7d is ALREADY PERCENT (same producer the table's Δ7d column uses), so
  // it is NOT ×100 here. /ips scales hero.mcapPct24h because THAT producer
  // returns a fraction; copying that across renders 100× high.
  const rows: OverviewMetricRow[] = ranked.map((p, i) => {
    const share = sharePct24(p, total24);
    const hasMkt = Number.isFinite(p.vol24Usd);
    const hasGacha = p.gachaVol24Usd != null && Number.isFinite(p.gachaVol24Usd);
    return {
      label: p.name,
      // No glossary key: the label names a platform, not a metric, and it's a
      // link — a tooltip trigger on the same word would fight it.
      value: p.total24Usd,
      unit: "usd" as const,
      // `?? null` because pct7d is OPTIONAL on PlatformRow: undefined would slip
      // past the row's `!= null` guard as a missing delta anyway, but null is the
      // type's own word for "belongs here, not available yet" → renders "—".
      deltaPct: p.pct7d ?? null,
      window: "7d" as const,
      // The leader carries the fold's headline number. It's the same claim the
      // ribbon's DOMINANCE makes, said once in figures.
      hero: i === 0,
      sublabel: p.chain,
      sub: share != null ? `${share.toFixed(1)}% share` : undefined,
      href: `/platform/${p.key}`,
      // The split that makes the total legible. "—" where we have no source:
      // Phygitals' marketplace volume is NaN, not zero, and a $0 would claim we
      // looked and found nothing traded.
      detail: [
        { label: "Marketplace", value: hasMkt ? formatCompactUsd(p.vol24Usd) : "—" },
        { label: "Gacha", value: hasGacha ? formatCompactUsd(p.gachaVol24Usd as number) : "—" },
      ],
    };
  });

  // ── Zone 2: one 14d card per platform ───────────────────────────────────────
  // Each card's series is that platform's own marketplace + gacha daily total —
  // the daily twin of the total24Usd its rail row leads with.
  const cards = ranked.map((p) => {
    const mkt = mktSeries[p.key];
    const gacha = gachaSeries[p.key];
    // "Gacha only" is read off the DATA, not hardcoded to Phygitals: no
    // marketplace series means we have no secondary source for this platform.
    // If one ever lands, the note disappears on its own.
    const gachaOnly = !(mkt?.length ?? 0) && (gacha?.length ?? 0) > 0;
    return {
      key: p.key,
      name: p.name,
      data: last14(totalDaily(mkt, gacha)),
      note: gachaOnly ? "gacha only" : undefined,
    };
  });

  return (
    <>
      <NavBar />
      <div className="px-8 pt-6 pb-20 font-sans">
        <h1 className="mb-3 text-[20px] font-bold leading-none tracking-[-0.01em]">
          Platforms Overview
        </h1>

        {/* Breadth + concentration, the questions a sorted list doesn't answer. */}
        <PlatformStatBar rows={data.platforms} />

        <div className="space-y-3">
          {/* ZONE 1 — the leaderboard + the Index Studio scoped to the platform
              family, so CC vs Beezie vs Courtyard compare out of the box. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[264px_minmax(0,1fr)] lg:items-start">
            <OverviewMetricColumn rows={rows} />
            <IndexStudio scope={{ entity: "platform" }} />
          </div>

          {/* ZONE 2 — one 14d card per platform, in leaderboard order, so the
              rail's ranking reads straight down into the cards. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((c) => (
              <MetricBarCard
                key={c.key}
                label={c.name}
                metric="total24h"
                data={c.data}
                unit="usd"
                note={c.note}
              />
            ))}
          </div>

          {/* ZONE 3 — the full list. */}
          <PlatformTable rows={data.platforms} chainFacets />
        </div>
      </div>
    </>
  );
}
