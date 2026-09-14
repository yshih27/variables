import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { Breadcrumbs } from "@/components/shell/Breadcrumbs";
import { StatCard, StatCardRow } from "@/components/StatCard";
import { SetTopSales } from "@/components/sets/SetTopSales";
import { SetCardsTable } from "@/components/sets/SetCardsTable";
import { IndexLevelsChart } from "@/components/indices/IndexLevelsChart";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { getIPDetail } from "@/lib/data/fetchIP";
import { getGradeSetPanel, setSales, WINDOW_DAYS } from "@/lib/data/gradeSetPanel";
import { setIndicesFor } from "@/lib/data/gradeSetIndex";
import { readIndexSeries } from "@/lib/data/indices";
import { formatCompactUsd } from "@/lib/format";

export const revalidate = 1800;

export default async function IPSetDetailPage({
  params,
}: {
  params: Promise<{ key: string; set: string }>;
}) {
  const { key, set } = await params;
  const [detail, ticker, panel, indices] = await Promise.all([
    getIPDetail(key),
    buildMarketTicker(),
    getGradeSetPanel(),
    setIndicesFor(key),
  ]);
  if (!detail) notFound();

  const sales = setSales(panel, key, set);
  const entity = indices.get(set) ?? null;
  // ⚠️ A set with neither sales in the window nor a published index does not
  // exist as a page. Rendering an empty shell for any slug someone types would
  // make every typo look like a real set that simply went quiet.
  if (sales.length === 0 && !entity) notFound();

  /**
   * ⚠️ THE DISPLAY NAME COMES FROM THE DATA, NOT FROM THE SLUG. The published
   * entity names it first (the naming SSOT), then the panel's own rows (the
   * set-name SSOT via readCardMeta). Only a set with neither — which `notFound()`
   * above has already excluded — would fall back to the raw key.
   */
  const name = entity?.name ?? sales[0]?.setName ?? set;
  const windowLabel = `${WINDOW_DAYS} complete days`;
  const volume = sales.reduce((t, s) => t + s.priceUsd, 0);
  const cards = new Set(sales.map((s) => s.tokenId)).size;
  const prices = sales.map((s) => s.priceUsd).sort((a, b) => a - b);
  const median = prices.length
    ? prices.length % 2
      ? prices[prices.length >> 1]
      : (prices[(prices.length >> 1) - 1] + prices[prices.length >> 1]) / 2
    : NaN;
  const money = (n: number) => (Number.isFinite(n) && n > 0 ? formatCompactUsd(n) : "—");

  const points = entity ? await readIndexSeries("set", entity.key, { kind: "price", from: "2000-01-01" }) : [];

  return (
    <>
      <NavBar ticker={ticker} />
      <div className="px-8 pt-6 pb-20 font-sans">
        <Breadcrumbs leaf={name} />
        <h1 className="mb-1 flex flex-wrap items-baseline gap-2 text-[20px] font-bold leading-none tracking-[-0.01em]">
          {name}
          {entity && <span className="font-mono text-[12px] font-normal text-ink-4">{entity.ticker}</span>}
        </h1>
        <p className="mb-3 max-w-2xl text-[13px] leading-relaxed text-ink-3">
          What sold in this set and what its price level is doing — over {windowLabel}
          {panel.toDay ? `, through ${panel.toDay.slice(0, 10)}` : ""}.{" "}
          <a href="/methodology#economics" className="text-ink-2 underline-offset-2 hover:text-yellow hover:underline">
            How this is measured →
          </a>
        </p>

        <div className="space-y-3">
          <StatCardRow cols={4}>
            <StatCard label={`Resale volume · ${windowLabel}`} value={money(volume)} sub={`${sales.length} sales`} accent />
            <StatCard label="Cards traded" value={cards ? String(cards) : "—"} sub="distinct tokens" />
            <StatCard label="Median price" value={money(median)} sub="across every sale in the window" />
            <StatCard
              label="Index level"
              value={entity?.level != null ? entity.level.toFixed(1) : "—"}
              deltaPct={entity?.changePct1m ?? null}
              deltaLabel="1m"
              sub={
                entity
                  ? `${entity.points} published months · 100 = base month`
                  : "not enough cards resell here for an index"
              }
            />
          </StatCardRow>

          <IndexLevelsChart
            series={
              entity && points.length >= 2
                ? [{ id: entity.id, ticker: entity.ticker, name: entity.name, color: "var(--color-yellow)", points }]
                : []
            }
            title="Price index"
            readMe="the same cards, priced month after month"
            subtitle="Identity comparables, monthly · month-end stamps"
            emptyNote="This set has volume but no index: an index needs the same card priced in consecutive months, and not enough of these cards resell."
          />

          {/* ── The side pair (different questions, §7) ─────────────────────
              "What were the biggest clears" and "which cards make up the set's
              volume" are two questions, so they may share a row. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <SetTopSales sales={sales} />
            <SetCardsTable sales={sales} />
          </div>
        </div>
      </div>
    </>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string; set: string }>;
}) {
  const { key, set } = await params;
  const detail = await getIPDetail(key);
  if (!detail) return { title: "Not found · VARIBLE" };
  return {
    title: `${set} · ${detail.ip.name} · VARIBLE`,
    description: `Resale volume, top sales and a monthly price index for this ${detail.ip.name} set.`,
  };
}
