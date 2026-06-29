import type { HotIP } from "@/lib/types";
import { IPIcon } from "./IPIcon";
import { Sparkline } from "./Sparkline";
import { formatCompactUsd, formatInt } from "@/lib/format";

type Props = { items: HotIP[] };

export function HotIPsPanel({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-bg-1">
      <div className="flex items-center gap-2.5 border-b border-line px-[22px] py-[18px]">
        <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-yellow px-2 text-[11px] font-bold uppercase tracking-[0.04em] text-black">
          🔥 Hot
        </span>
        <span className="text-[15px] font-semibold">Hottest IPs</span>
        <span className="ml-auto text-[11.5px] text-ink-3">top {items.length} · 24h vol</span>
      </div>
      <div className="flex flex-col gap-0.5 p-2">
        {items.map((ip) => (
          <a
            key={ip.key}
            href={`/ip/${ip.key}`}
            className="grid grid-cols-[24px_36px_1fr_auto] items-center gap-3.5 rounded-[10px] px-3.5 py-3 transition-colors hover:bg-bg-2 sm:grid-cols-[24px_36px_1fr_auto_auto]"
          >
            <span className="w-[24px] text-center text-[12px] text-ink-3 tabular">
              {String(ip.rank).padStart(2, "0")}
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
              <span className="truncate text-[11.5px] text-ink-3 tabular">
                {formatInt(ip.buyers24h)} buyer{ip.buyers24h === 1 ? "" : "s"}
              </span>
            </span>
            <span className="hidden sm:block">
              <Sparkline data={ip.spark} trend={ip.trend} width={72} height={24} />
            </span>
            <span className="text-[13px] font-bold tabular text-ink">
              {formatCompactUsd(ip.vol24Usd)}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
