import type { ReactNode } from "react";
import type { IPRow } from "@/lib/types";
import { concentrationHHI, type CategoryAggregate } from "@/lib/category/rollup";
import { hasRealMcap } from "@/lib/ip/mcap";

/**
 * Category structure ribbon for the /ips overview — concentration + breadth, the
 * questions the homepage's totals don't answer. Deliberately NOT market cap /
 * 24h volume (those are the overview's headline levels). A single compact line of
 * label·value pairs (was a 4-tile strip) so the top of the page stays dense.
 */
function liquidCount(rows: IPRow[]): { liquid: number; total: number } {
  let liquid = 0;
  for (const ip of rows) {
    // A 4th copy of the mcap gate lived here and carried the same `cards >= 5`
    // bug — an IP with a real cap dropped out of "liquid" on a day it didn't
    // trade. The trading half of the test is `vol24Usd > 0`, which is where an
    // activity check belongs.
    if (hasRealMcap(ip) || (Number.isFinite(ip.vol24Usd) && ip.vol24Usd > 0)) liquid++;
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
  const items: { label: string; value: ReactNode }[] = [
    { label: "Categories", value: <span className="tabular">{categories.length}</span> },
    {
      label: "Liquid IPs",
      value: (
        <span className="tabular">
          {liquid} <span className="text-ink-3">/ {total}</span>
        </span>
      ),
    },
    {
      label: "Dominance",
      value: top ? (
        <span>
          {top.group}{" "}
          <span className="tabular" style={{ color: top.color }}>
            {Math.round(top.sharePct)}%
          </span>
        </span>
      ) : (
        "—"
      ),
    },
    {
      label: "Concentration",
      value: (
        <span>
          {hhiLabel(hhi)} <span className="tabular text-ink-3">· HHI {hhi.toFixed(2)}</span>
        </span>
      ),
    },
  ];
  return (
    <section className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line px-4 py-2 text-[12.5px]">
      {items.map((it, i) => (
        <div key={it.label} className="flex items-center gap-x-3">
          {i > 0 && <span aria-hidden className="text-ink-4">·</span>}
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-4">{it.label}</span>
            <span className="font-semibold text-ink-2">{it.value}</span>
          </span>
        </div>
      ))}
    </section>
  );
}
