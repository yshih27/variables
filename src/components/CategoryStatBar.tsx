import type { ReactNode } from "react";
import type { IPRow } from "@/lib/types";
import { concentrationHHI, type CategoryAggregate } from "@/lib/category/rollup";

/**
 * Category structure strip for the /ips overview — concentration + breadth, the
 * questions the homepage's totals don't answer. Deliberately NOT market cap /
 * 24h volume (those are the homepage's quick answers). A thin Rarible-style bar,
 * not chunky tiles.
 */
function liquidCount(rows: IPRow[]): { liquid: number; total: number } {
  let liquid = 0;
  for (const ip of rows) {
    const qualified = Number.isFinite(ip.mcapUsd) && ip.mcapUsd >= 1000 && ip.cards >= 5;
    if (qualified || (Number.isFinite(ip.vol24Usd) && ip.vol24Usd > 0)) liquid++;
  }
  return { liquid, total: rows.length };
}

function hhiLabel(hhi: number): string {
  if (hhi >= 0.4) return "High";
  if (hhi >= 0.2) return "Moderate";
  return "Low";
}

export function CategoryStatBar({ rows, categories }: { rows: IPRow[]; categories: CategoryAggregate[] }) {
  const { liquid, total } = liquidCount(rows);
  const top = categories[0] ?? null;
  const hhi = concentrationHHI(categories);
  return (
    <section className="mb-7 flex flex-wrap overflow-hidden rounded-xl border border-line">
      <Stat label="Categories" value={<span className="tabular">{categories.length}</span>} />
      <Stat
        label="Liquid IPs"
        value={
          <span className="tabular">
            {liquid} <span className="text-ink-3">/ {total}</span>
          </span>
        }
      />
      <Stat
        label="Dominance"
        value={
          top ? (
            <span>
              {top.group} <span className="tabular" style={{ color: top.color }}>{Math.round(top.sharePct)}%</span>
            </span>
          ) : (
            "—"
          )
        }
      />
      <Stat
        label="Concentration"
        value={
          <span>
            {hhiLabel(hhi)} <span className="tabular text-[12px] text-ink-3">· HHI {hhi.toFixed(2)}</span>
          </span>
        }
      />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-[150px] flex-1 border-line px-4 py-3 [&:not(:last-child)]:border-r">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">{label}</div>
      <div className="text-[15px] font-semibold">{value}</div>
    </div>
  );
}
