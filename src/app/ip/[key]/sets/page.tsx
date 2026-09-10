import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { StatCard, StatCardRow } from "@/components/StatCard";
import { SetLeaderboard } from "@/components/sets/SetLeaderboard";
import { IndexLevelsChart } from "@/components/indices/IndexLevelsChart";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { getIPDetail } from "@/lib/data/fetchIP";
import { getGradeSetPanel, setRows, WINDOW_DAYS } from "@/lib/data/gradeSetPanel";
import { setIndicesFor } from "@/lib/data/gradeSetIndex";
import { readIndexSeries } from "@/lib/data/indices";
import { PALETTE } from "@/lib/studio/catalog";
import { formatCompactUsd } from "@/lib/format";

export const revalidate = 1800;

export default async function IPSetsPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const [detail, ticker, panel, indices] = await Promise.all([
    getIPDetail(key),
    buildMarketTicker(),
    getGradeSetPanel(),
    setIndicesFor(key),
  ]);
  if (!detail) notFound();

  const rows = setRows(panel, key);
  const windowLabel = `${WINDOW_DAYS} complete days`;
  const totalVol = rows.reduce((t, r) => t + r.volumeUsd, 0);
  const totalSales = rows.reduce((t, r) => t + r.sales, 0);
  const top = rows[0] ?? null;
  const money = (n: number) => (Number.isFinite(n) && n > 0 ? formatCompactUsd(n) : "—");

  const published = [...indices.values()];
  const levelSeries = await Promise.all(
    published.map(async (e, i) => ({
      id: e.id,
      ticker: e.ticker,
      name: e.name,
      color: PALETTE[i % PALETTE.length],
      points: await readIndexSeries("set", e.key, { kind: "price", from: "2000-01-01" }),
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
          {detail.ip.name} · Sets
        </h1>
        <p className="mb-3 max-w-2xl text-[13px] leading-relaxed text-ink-3">
          Which sets carry the resale market, and what a set&apos;s price level is doing — over{" "}
          {windowLabel}
          {panel.toDay ? `, through ${panel.toDay.slice(0, 10)}` : ""}.{" "}
          <a href="/methodology#economics" className="text-ink-2 underline-offset-2 hover:text-yellow hover:underline">
            How this is measured →
          </a>
        </p>

        <div className="space-y-3">
          <StatCardRow cols={4}>
            <StatCard
              label={`Resale volume · ${windowLabel}`}
              value={money(totalVol)}
              sub={`${totalSales.toLocaleString()} sales`}
              accent
            />
            <StatCard
              label={top ? `Top set · ${top.name}` : "Top set"}
              value={top && totalVol > 0 ? `${((top.volumeUsd / totalVol) * 100).toFixed(0)}%` : "—"}
              sub={top ? `${money(top.volumeUsd)} of the window's volume` : "no resales in the window"}
            />
            <StatCard
              label="Sets traded"
              value={rows.length ? String(rows.length) : "—"}
              sub={`${indices.size} with a published index`}
            />
            <StatCard
              label="Median price"
              value={money(rows.length ? rows.reduce((t, r) => t + r.medianPriceUsd * r.sales, 0) / Math.max(totalSales, 1) : NaN)}
              sub="sales-weighted across sets"
            />
          </StatCardRow>

          {/* ⚠️ ONE ZONE, NOT A PAIR. The set index levels answer the same
              question the leaderboard's index column does, at a different grain —
              §3 lets two DIFFERENT questions share a row, and these are not two. */}
          <IndexLevelsChart
            series={levelSeries}
            title="Set index levels"
            readMe="what a set's cards are worth, month over month"
            subtitle="Identity comparables, monthly · rebased to the shared base month"
            emptyNote="No set clears the identity floor for a published index yet — the leaderboard below still has volume and sales for every set that traded."
          />

          <SetLeaderboard rows={rows} indices={indices} ip={key} windowLabel={windowLabel} />

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
    title: `${detail.ip.name} Sets · VARIBLE`,
    description: `Which ${detail.ip.name} sets carry the resale market — volume, sales and a monthly price index where the cards resell.`,
  };
}
