import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { StatCard, StatCardRow } from "@/components/StatCard";
import { GradePremiumChart } from "@/components/grades/GradePremiumChart";
import { GradeShareChart } from "@/components/grades/GradeShareChart";
import { GradeTable } from "@/components/grades/GradeTable";
import { IndexLevelsChart } from "@/components/indices/IndexLevelsChart";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { getIPDetail } from "@/lib/data/fetchIP";
import { getGradeSetPanel, gradeRows, gradeShareDaily, WINDOW_DAYS } from "@/lib/data/gradeSetPanel";
import { listGradeIndices, readPremiumSeries } from "@/lib/data/gradeSetIndex";
import { readIndexSeries } from "@/lib/data/indices";
import { PALETTE } from "@/lib/studio/catalog";
import { formatCompactUsd } from "@/lib/format";

// ISR: every input is snapshot- or cache-backed. Same 30 min as the overviews.
export const revalidate = 1800;

/** Grades that get their own band in the share chart; the rest pool into "Other". */
const SHARE_BANDS = 5;

export default async function IPGradesPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const [detail, ticker, panel, indices, premiums] = await Promise.all([
    getIPDetail(key),
    buildMarketTicker(),
    getGradeSetPanel(),
    listGradeIndices(),
    readPremiumSeries(),
  ]);
  if (!detail) notFound();

  const rows = gradeRows(panel, key);
  /**
   * ⚠️ KEYED BY THE CANONICAL LABEL, NOT THE SLUG. The blob's entity is
   * `grade:psa-10` while a panel row carries "PSA 10" (canonicalGrade). Rather
   * than re-implementing the backend's slug rule on this side — a second answer
   * that could drift — the map keys on `labelFor().name`, which the naming SSOT
   * derives from the same slug: "psa-10" → "PSA 10", "cgc-9-5" → "CGC 9.5".
   */
  const byGrade = new Map(indices.map((e) => [e.name, e]));
  const windowLabel = `${WINDOW_DAYS} complete days`;

  // The share chart's bands are the table's own top grades, so the two zones
  // name the same things in the same order.
  const bands = rows.slice(0, SHARE_BANDS).map((r) => r.grade);
  const shareDays = gradeShareDaily(panel, key, bands);

  /**
   * ⚠️ ONE COLOUR PER GRADE, ACROSS BOTH HALVES OF THE PAIR. The two charts sort
   * differently — the share chart by volume, the index chart by level — so
   * assigning palette slots by array position gave PSA 10 one colour on the left
   * and another on the right, in a pair the eye reads as one figure. The key is
   * the grade, not the position.
   */
  const gradeColor = (() => {
    const order = [...new Set([...rows.map((r) => r.grade), ...indices.map((e) => e.name)])];
    const m = new Map(order.map((g, i) => [g, PALETTE[i % PALETTE.length]]));
    return (g: string) => m.get(g) ?? "var(--color-line-2)";
  })();
  const shareColors: Record<string, string> = Object.fromEntries([
    ...bands.map((g) => [g, gradeColor(g)]),
    ["Other", "var(--color-line-2)"],
  ]);

  const totalVol = rows.reduce((t, r) => t + r.volumeUsd, 0);
  const totalSales = rows.reduce((t, r) => t + r.sales, 0);
  const top = rows[0] ?? null;
  const money = (n: number) => (Number.isFinite(n) && n > 0 ? formatCompactUsd(n) : "—");

  // `listGradeIndices` carries only each entity's summary, so the points are read
  // here. Cheap: every one of these reads hits the same cached snapshot.
  const levelSeries = await Promise.all(
    indices.map(async (e) => ({
      id: e.id,
      ticker: e.ticker,
      name: e.name,
      color: gradeColor(e.name),
      points: await readIndexSeries("grade", e.key, { kind: "price", from: "2000-01-01" }),
    })),
  );

  return (
    <>
      <NavBar ticker={ticker} />
      <div className="px-8 pt-6 pb-20 font-sans">
        <a href={`/ip/${key}`} className="mb-1.5 inline-block text-[12px] text-ink-3 transition-colors hover:text-yellow">
          ← {detail.ip.name}
        </a>
        <h1 className="mb-1 text-[20px] font-bold leading-none tracking-[-0.01em]">
          {detail.ip.name} · Grades
        </h1>
        <p className="mb-3 max-w-2xl text-[13px] leading-relaxed text-ink-3">
          What a grade costs relative to the one below it, and whether that premium is
          widening or narrowing — over {windowLabel}
          {panel.toDay ? `, through ${panel.toDay.slice(0, 10)}` : ""}.{" "}
          <a href="/methodology#economics" className="text-ink-2 underline-offset-2 hover:text-yellow hover:underline">
            How this is measured →
          </a>
        </p>

        <div className="space-y-3">
          {/* ── ZONE 1 — the KPI strip ─────────────────────────────────────── */}
          <StatCardRow cols={4}>
            <StatCard
              label={`Resale volume · ${windowLabel}`}
              value={money(totalVol)}
              sub={`${totalSales.toLocaleString()} sales`}
              accent
            />
            <StatCard
              label={top ? `Top grade · ${top.grade}` : "Top grade"}
              value={top ? `${top.sharePct.toFixed(0)}%` : "—"}
              sub={top ? `${money(top.volumeUsd)} of the window's volume` : "no resales in the window"}
            />
            <StatCard
              label="Grades traded"
              value={rows.length ? String(rows.length) : "—"}
              sub={`${byGrade.size} with a published index`}
            />
            <StatCard
              label="Median price"
              value={money(rows.length ? rows.reduce((t, r) => t + r.medianPriceUsd * r.sales, 0) / Math.max(totalSales, 1) : NaN)}
              sub="sales-weighted across grades"
            />
          </StatCardRow>

          {/* ── ZONE 2 — the hero canvas ───────────────────────────────────
              One question: what does a grade cost relative to the next. The four
              pairs are four answers to it, so they are switches on one chart
              rather than four charts (one question per zone). */}
          <GradePremiumChart series={premiums} />

          {/* ── ZONE 3 — the side pair (different questions, §7) ────────────
              "What is a grade worth" and "what is the market buying" are two
              questions, so they may share a row. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <IndexLevelsChart
              series={levelSeries}
              title="Grade index levels"
              readMe="what a grade is worth, month over month"
              subtitle="Market-wide identity comparables, monthly · rebased to the shared base month"
              emptyNote="No grade clears the identity floor for a published index yet."
              fill
            />
            <GradeShareChart days={shareDays} grades={bands} colors={shareColors} />
          </div>

          {/* ── ZONE 4 — the table ─────────────────────────────────────────── */}
          <GradeTable rows={rows} indices={byGrade} windowLabel={windowLabel} />

          {panel.unresolved > 0 && (
            <p className="font-mono text-[10.5px] text-ink-4">
              {panel.unresolved} sale{panel.unresolved > 1 ? "s" : ""} in the window had no card
              metadata and are excluded from every figure above.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const detail = await getIPDetail(key);
  if (!detail) return { title: "Not found · VARIBLE" };
  return {
    title: `${detail.ip.name} Grades · VARIBLE`,
    description: `Grade premiums, index levels and resale share by grade for ${detail.ip.name} — PSA 10 against PSA 9, CGC against PSA, monthly.`,
  };
}
