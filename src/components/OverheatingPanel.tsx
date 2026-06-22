import type { IPRow } from "@/lib/types";
import { IPIcon } from "./IPIcon";
import { formatCompactUsd, formatInt } from "@/lib/format";

/** Catch-all bucket isn't a watchable franchise — exclude from the heat board. */
const EXCLUDE = new Set(["other"]);

type Mover = { ip: IPRow; turnover: number };

/**
 * Turnover = 24h volume ÷ market cap. Because per-IP market cap is appraisal-
 * based (sticky day to day), price % barely moves — turnover is the real
 * "balloon economy" signal: how much of the asset base is changing hands today.
 */
function buildMovers(ips: IPRow[]): Mover[] {
  return ips
    .filter(
      (ip) =>
        !EXCLUDE.has(ip.key) &&
        Number.isFinite(ip.mcapUsd) &&
        ip.mcapUsd >= 1000 &&
        ip.cards >= 5 &&
        ip.vol24Usd > 0,
    )
    .map((ip) => ({ ip, turnover: ip.vol24Usd / ip.mcapUsd }))
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, 6);
}

function heatColor(t: number): string {
  if (t >= 0.05) return "#ff8a3d"; // hot — orange
  if (t >= 0.01) return "var(--color-yellow-2)"; // warm
  return "var(--color-ink-2)"; // calm
}

function turnoverLabel(t: number): string {
  const v = t * 100;
  if (v >= 100) return ">100%";
  if (v < 0.1) return "<0.1%";
  return `${v.toFixed(1)}%`;
}

export function OverheatingPanel({ ips }: { ips: IPRow[] }) {
  const movers = buildMovers(ips);
  if (movers.length === 0) return null;
  const maxT = movers[0].turnover || 1;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-bg-1">
      <div className="flex items-center gap-2.5 border-b border-line px-[22px] py-[18px]">
        <span
          className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] font-bold uppercase tracking-[0.04em] text-black"
          style={{ background: "#ff8a3d" }}
        >
          🎈 Heat
        </span>
        <span className="text-[15px] font-semibold">Overheating</span>
        <span
          className="ml-auto cursor-help text-[11.5px] text-ink-3"
          title="Turnover = 24h volume ÷ market cap. High turnover with few buyers can signal a speculative run-up that's about to cool."
        >
          top {movers.length} · turnover
        </span>
      </div>
      <div className="flex flex-col gap-0.5 p-2">
        {movers.map(({ ip, turnover }, i) => (
          <a
            key={ip.key}
            href={`/ip/${ip.key}`}
            className="grid grid-cols-[24px_36px_1fr_auto] items-center gap-3.5 rounded-[10px] px-3.5 py-3 transition-colors hover:bg-bg-2"
          >
            <span className="w-[24px] text-center text-[12px] text-ink-3">
              {String(i + 1).padStart(2, "0")}
            </span>
            <IPIcon
              name={ip.name}
              short={ip.short}
              color={ip.color}
              logo={ip.logo}
              iconBlendMode={ip.iconBlendMode}
              emoji={ip.emoji}
              size={36}
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[14px] font-semibold">{ip.name}</span>
              <span className="text-[11.5px] text-ink-3 tabular">
                {formatInt(ip.buyers24h)} buyers · {formatCompactUsd(ip.vol24Usd)} 24h
              </span>
            </span>
            <span className="flex flex-col items-end gap-1.5">
              <span className="text-[13px] font-bold tabular" style={{ color: heatColor(turnover) }}>
                {turnoverLabel(turnover)}
              </span>
              <span className="block h-[3px] w-[56px] overflow-hidden rounded-full bg-bg-3">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(6, Math.min(100, (turnover / maxT) * 100))}%`,
                    background: heatColor(turnover),
                  }}
                />
              </span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
