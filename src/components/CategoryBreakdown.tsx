import type { CategoryAggregate } from "@/lib/category/rollup";
import { Sparkline } from "./Sparkline";
import { formatCompactUsd } from "@/lib/format";

/**
 * Dense category breakdown — TCG / Sports / Other as ranked rows in Rarible's
 * column-table posture (crisp edges, share bars, turnover, momentum, sparkline),
 * so it rhymes with the IP leaderboard below it instead of floating as cards.
 */
export function CategoryBreakdown({ categories }: { categories: CategoryAggregate[] }) {
  if (categories.length === 0) return null;
  return (
    <section className="mb-12">
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Category breakdown</h2>
        <span className="text-[11.5px] text-ink-4">share of tracked market cap</span>
      </div>
      <div className="scroll-x">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-[0.05em] text-ink-3">
              <Th align="left">Category</Th>
              <Th>Market cap</Th>
              <Th>Share</Th>
              <Th>24h vol</Th>
              <Th>Turnover</Th>
              <Th>7d vol</Th>
              <Th>30d trend</Th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.group} className="border-b border-line/60">
                <td className="px-3 py-3.5">
                  <span className="flex items-center gap-2.5 font-semibold">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c.color }} />
                    {c.group}
                    <span className="font-mono text-[12px] font-normal text-ink-3">
                      {c.ipCount} {c.ipCount === 1 ? "IP" : "IPs"}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-3.5 text-right font-semibold tabular">{formatCompactUsd(c.mcapUsd)}</td>
                <td className="px-3 py-3.5 text-right">
                  <span className="inline-flex items-center justify-end gap-2.5">
                    <span className="tabular text-ink-2">{Math.round(c.sharePct)}%</span>
                    <span className="block h-1.5 w-[52px] overflow-hidden rounded-full bg-bg-3">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${Math.max(2, Math.min(100, c.sharePct))}%`, background: c.color }}
                      />
                    </span>
                  </span>
                </td>
                <td className="px-3 py-3.5 text-right tabular">{formatCompactUsd(c.vol24Usd)}</td>
                <td className="px-3 py-3.5 text-right tabular text-ink-2">{formatTurnover(c.turnoverPct)}</td>
                <td className="px-3 py-3.5 text-right">
                  <DeltaPct pct={c.mom7dPct} />
                </td>
                <td className="px-3 py-3.5">
                  <div className="flex justify-end">
                    {c.spark.length >= 2 ? (
                      <Sparkline data={c.spark} trend={c.trend} width={70} height={22} />
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-3 py-2.5 font-medium ${align === "left" ? "text-left" : "text-right"}`}>{children}</th>;
}

function formatTurnover(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%`;
}

function DeltaPct({ pct }: { pct: number | null }) {
  if (pct == null || !Number.isFinite(pct)) return <span className="text-ink-4">—</span>;
  const cls = pct > 0.05 ? "text-green" : pct < -0.05 ? "text-red" : "text-ink-3";
  return (
    <span className={`font-semibold tabular ${cls}`}>
      {pct > 0 ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}
