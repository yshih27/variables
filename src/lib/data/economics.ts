import { unstable_cache } from "next/cache";
import type { EconomicsBoard, EconomicsPlatform, EconomicsTier } from "@/lib/types";
import type { NetHeldReason } from "@/lib/metrics/outboundDisclosure";
import { outboundDisclosureFor } from "@/lib/metrics/outboundDisclosure";
import { PLATFORM_SOURCES } from "./sources";
import { getPlatformDetail, getPlatformActivitySeries } from "./fetchPlatform";
import {
  latestCompleteDay,
  sumLastCompleteDays,
  lastNDays,
  type SeriesPoint,
} from "./metricSnapshots";
import { readPlayerAnalytics, type PlatformPlayerAnalytics } from "./playerAnalytics";

/**
 * The /economics board — one typed answer to "what does a gacha platform keep?"
 * across every tracked venue.
 *
 * ZERO new reads. Every figure comes from `getPlatformDetail` (v9) and
 * `getPlatformActivitySeries`, both already cached, plus the one
 * `player-analytics` snapshot row the platform pages read. This helper's job is
 * to do the per-platform fan-out ONCE, server-side, so the page is a render and
 * not an orchestration.
 *
 * ⚠️ THE HOLD IS ENCODED IN THE DATA, NOT LEFT TO THE VIEW. `net30d` is emitted
 * only when `heldReason` is null, and the board-level `net30d` only when NO
 * contributor is held. A component cannot accidentally print a held net, because
 * there is no held net in the object to print.
 */

const WINDOW_DAYS = 30;

/**
 * Σ the 30 complete days ENDING one window before the newest — the prior-period
 * basis for the ratio's trend.
 *
 * Implemented by dropping the newest window's days and re-summing, rather than by
 * slicing point counts: a sparse series' "last 60 points" can span far more than
 * 60 days, and the trend would then compare two windows of different lengths.
 */
function sumPrior(series: SeriesPoint[], days: number): number {
  const cut = latestCompleteDay(new Map([["s", series]]));
  if (!cut) return NaN;
  const cutMs = Date.parse(cut);
  if (!Number.isFinite(cutMs)) return NaN;
  const priorEnd = cutMs - days * 86_400_000;
  return sumLastCompleteDays(
    series.filter((p) => Date.parse(p.ts) <= priorEnd),
    days,
  );
}

/** A ratio only where BOTH legs are real. A missing outbound leg is not a zero. */
function ratio(outbound: number, spend: number): number | null {
  if (!Number.isFinite(outbound) || !Number.isFinite(spend) || !(spend > 0)) return null;
  return (outbound / spend) * 100;
}

async function buildOne(
  key: string,
  name: string,
  players: ReturnType<typeof playerProjection>,
  partnerAttributedPct: number | null,
): Promise<EconomicsPlatform> {
  const [detail, series] = await Promise.all([
    getPlatformDetail(key),
    getPlatformActivitySeries(key),
  ]);
  const disclosure = outboundDisclosureFor(key);

  if (!detail) {
    return {
      key, name,
      spend30d: NaN, outbound30d: null, ratioPct30d: null, ratioPctPrior30d: null,
      r3VerifiedPct30d: null, net30d: null, heldReason: "unsourced", disclosure,
      players, partnerAttributedPct, spendDaily: [], outboundDaily: [],
    };
  }

  // The SAME gate the platform page applies: one cutoff across all three streams,
  // so a Dune-lagged trailing day can't draw a tall spend bar beside a missing
  // outflow bar and read as a windfall.
  const spendS = series.gacha;
  const payoutS = detail.buybackDaily;
  // Before the Dune switchover `outflow_gross_usd` doesn't exist and
  // `buyback_payout_usd` still holds the gross definition — the same quantity
  // under its old name, which is why this fallback is not a fudge.
  const grossS = detail.outflowGrossDaily.length > 0 ? detail.outflowGrossDaily : payoutS;
  const cut = latestCompleteDay(
    new Map([["spend", spendS], ["outbound", grossS], ["payout", payoutS]]),
  );
  const gate = (s: SeriesPoint[]) => (cut ? s.filter((p) => p.ts <= cut) : s);
  const spendGated = gate(spendS);
  const grossGated = gate(grossS);

  const spend30d = sumLastCompleteDays(spendGated, WINDOW_DAYS);
  // ⚠️ SUPPRESSED PLATFORMS PUBLISH NO OUTBOUND FIGURE AT ALL — not the sum, not
  // the ratio, not the series. Phygitals' exclusion list misses its dominant
  // non-player counterparties, so the flow is real but the label would not be.
  const sourced = grossGated.length > 0;
  const publishOutbound = sourced && disclosure === "gross";
  const outbound30d = publishOutbound ? sumLastCompleteDays(grossGated, WINDOW_DAYS) : null;

  const heldReason: NetHeldReason | null = detail.heldReason ?? null;

  return {
    key,
    name,
    spend30d,
    outbound30d: outbound30d != null && Number.isFinite(outbound30d) ? outbound30d : null,
    ratioPct30d: publishOutbound ? ratio(sumLastCompleteDays(grossGated, WINDOW_DAYS), spend30d) : null,
    ratioPctPrior30d: publishOutbound
      ? ratio(sumPrior(grossGated, WINDOW_DAYS), sumPrior(spendGated, WINDOW_DAYS))
      : null,
    r3VerifiedPct30d: publishOutbound ? detail.r3VerifiedPct30d : null,
    // ⚠️ The hold, expressed once: a net exists only when nothing holds it.
    net30d: heldReason === null ? (detail.netGachaRevenue?.usd30d ?? null) : null,
    heldReason,
    disclosure,
    players,
    partnerAttributedPct,
    spendDaily: lastNDays(spendGated, WINDOW_DAYS),
    outboundDaily: publishOutbound ? lastNDays(grossGated, WINDOW_DAYS) : [],
  };
}

/** Player concentration + tiers, projected to the board's own shape. */
function playerProjection(
  p: PlatformPlayerAnalytics | null | undefined,
): { top1PctSharePct: number; tiers: EconomicsTier[] } | null {
  const share = p?.concentration?.top1PctShare;
  if (!p || !Number.isFinite(share)) return null;
  return {
    // ⚠️ Already 0–100 from the backend. Never ×100 (the house percent hazard —
    // the same one mcapPct24h sets on the other side).
    top1PctSharePct: share as number,
    tiers: p.tiers.map((t) => ({ label: t.label, pctUsers: t.pctUsers, pctRevenue: t.pctRevenue })),
  };
}

async function build(): Promise<EconomicsBoard> {
  const snap = await readPlayerAnalytics();

  const platforms = await Promise.all(
    PLATFORM_SOURCES.map((src) => {
      const pa = snap?.platforms.find((p) => p.platform === src.key) ?? null;
      const partners = (snap as { partners?: Record<string, { attributedPct?: number }> } | null)
        ?.partners?.[src.key];
      const attributed =
        partners && Number.isFinite(partners.attributedPct) ? (partners.attributedPct as number) : null;
      return buildOne(src.key, src.name, playerProjection(pa), attributed);
    }),
  );

  // ── Market-wide, and the ratio's own narrower basis ────────────────────────
  const sourced = platforms.filter((p) => p.outbound30d != null);
  const fin = (n: number) => (Number.isFinite(n) ? n : 0);
  /**
   * ⚠️ TWO SPENDS, DELIBERATELY, AND THEY ARE NOT INTERCHANGEABLE.
   *
   * `spend30d` is EVERY tracked venue — it is what the hero draws and what the
   * KPI strip labels "5 venues". It used to be the sourced subset, which meant
   * the strip's headline spend was one venue's number wearing a market label
   * while the chart under it drew five (polish r1, Sep 8).
   *
   * `spendSourced30d` is the ratio's denominator and must stay the subset: a
   * ratio of one venue's outbound over five venues' spend is not a payout rate,
   * it is a coverage artifact that would read as a healthy 20%.
   */
  const spend30d = platforms.reduce((s, p) => s + fin(p.spend30d), 0);
  const spendSourced30d = sourced.reduce((s, p) => s + fin(p.spend30d), 0);
  const outbound30d = sourced.length ? sourced.reduce((s, p) => s + (p.outbound30d ?? 0), 0) : null;
  const priorSpend = sourced.reduce((s, p) => s + fin(p.ratioPctPrior30d != null ? p.spend30d : 0), 0);

  // ⚠️ NEVER A PARTIAL SUM. Any hold among the contributors and the market net is
  // withheld entirely — a net that quietly excludes the one platform we can count
  // would be more misleading than no net at all.
  const contributors = platforms.filter((p) => p.disclosure === "gross" && p.outboundDaily.length > 0);
  const heldReasons = [
    ...new Set(contributors.map((p) => p.heldReason).filter((r): r is NetHeldReason => r != null)),
  ];
  const net30d =
    contributors.length > 0 && heldReasons.length === 0
      ? contributors.reduce((s, p) => s + (p.net30d ?? 0), 0)
      : null;

  const asOf =
    platforms
      .flatMap((p) => p.spendDaily.map((d) => d.ts))
      .sort()
      .at(-1) ?? null;

  return {
    windowDays: WINDOW_DAYS,
    asOf,
    platforms,
    spend30d,
    spendSourced30d,
    outbound30d,
    ratioPct30d: outbound30d != null ? ratio(outbound30d, spendSourced30d) : null,
    ratioPctPrior30d:
      priorSpend > 0
        ? ratio(
            sourced.reduce(
              (s, p) => s + (p.ratioPctPrior30d != null ? (p.ratioPctPrior30d / 100) * p.spend30d : 0),
              0,
            ),
            priorSpend,
          )
        : null,
    net30d,
    heldReasons,
    generatedAt: snap?.generatedAt ?? "",
  };
}

const EMPTY: EconomicsBoard = {
  windowDays: WINDOW_DAYS,
  asOf: null,
  platforms: [],
  spend30d: NaN,
  spendSourced30d: NaN,
  outbound30d: null,
  ratioPct30d: null,
  ratioPctPrior30d: null,
  net30d: null,
  heldReasons: [],
  generatedAt: "",
};

/**
 * Cached, total accessor. 30 min / `platform-buckets`, matching every other
 * page-level cache, so the fan-out costs one fill per window.
 *
 * NEVER THROWS — a page that leads with a hold must not itself be able to fail.
 */
export const buildEconomicsBoard: () => Promise<EconomicsBoard> = unstable_cache(
  async () => {
    try {
      return await build();
    } catch {
      return EMPTY;
    }
  },
  ["economics-board:v1"],
  { revalidate: 1800, tags: ["platform-buckets"] },
);
