import { Sparkline } from "@/components/Sparkline";
import { deltaDir, formatDelta } from "@/lib/format";
import type { RailNode } from "@/lib/types";

/**
 * A rail node's live micro-spark + 24h delta.
 *
 * ⚠️ ABSENCE IS RENDERED AS ABSENCE. `spark: null` draws NOTHING — not a flat
 * line, which would assert "this didn't move" when the truth is "we have no
 * series for it". `deltaPct: null` renders "—". Both rules live in
 * `buildRailModel`; this component only has to not undo them.
 *
 * The delta's WINDOW is always printed beside it, and `title` names the MEASURE,
 * because the rail mixes them: market cap for the market and the IPs (the payload
 * carries no 24h volume delta per IP), volume momentum for the platforms.
 */
export function RailSpark({ node }: { node: RailNode }) {
  const dir = deltaDir(node.deltaPct);
  const cls = dir === "up" ? "text-green" : dir === "down" ? "text-red" : "text-ink-4";
  const measure = node.deltaLabel ? `${node.deltaLabel}, ${node.deltaWindow}` : node.deltaWindow;
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {node.spark ? (
        <Sparkline data={node.spark} trend={dir} width={40} height={14} />
      ) : (
        <span className="w-10" aria-hidden />
      )}
      <span
        className={`w-[46px] text-right tabular text-[10.5px] font-semibold ${cls}`}
        title={node.deltaPct == null ? `no ${measure} delta yet` : measure}
      >
        {formatDelta(node.deltaPct)}
      </span>
    </span>
  );
}
