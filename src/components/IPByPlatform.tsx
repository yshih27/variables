"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dropdown } from "./Dropdown";
import { Section } from "./Section";
import { formatCompactUsd, formatCompactNumber, formatInt } from "@/lib/format";

export type PlatformRow = {
  key: string;
  name: string;
  chain: string;
  chainColor: string;
  color: string; // donut/segment color
  cards: number | null;
  vol24Usd: number;
  mcapUsd: number | null;
  trades24h: number;
  avgTradeUsd: number;
  holders: number | null;
};

type DonutMetric = "volume" | "trades";
const METRIC_OPTS = [
  { value: "volume" as const, label: "Volume" },
  { value: "trades" as const, label: "Trades" },
];

function metricValue(r: PlatformRow, m: DonutMetric): number {
  return m === "trades" ? r.trades24h : r.vol24Usd;
}

/**
 * "By Platform" table (how this IP trades across marketplaces) + a Platform-share
 * donut. vol / trades / avg-trade / holders / chain are real; per-platform market
 * cap is holder-share apportioned; per-platform card counts aren't tracked ("—").
 * Only platforms with IP-scoped sales data appear (today: Beezie, Collector Crypt).
 */
export function IPByPlatform({
  rows,
  title = "By Platform",
  subtitle = "How this IP trades across tracked marketplaces",
  entityHeader = "Platform",
  donutTitle = "Platform share",
  showChain = true,
  hrefBase,
}: {
  rows: PlatformRow[];
  title?: string;
  subtitle?: string;
  entityHeader?: string;
  donutTitle?: string;
  showChain?: boolean;
  /** When set, each row links to `${hrefBase}${row.key}` (e.g. "/platform/").
   *  The synthetic "other" bucket never links. */
  hrefBase?: string;
}) {
  const [metric, setMetric] = useState<DonutMetric>("volume");
  const [hover, setHover] = useState<string | null>(null);
  const router = useRouter();

  const total = rows.reduce((a, r) => a + metricValue(r, metric), 0) || 1;
  const shares = rows.map((r) => ({ ...r, share: metricValue(r, metric) / total }));

  return (
    <Section title={title} subtitle={subtitle} className="mb-12 font-sans">
      <div className="grid grid-cols-1 gap-10 pt-1 min-[1024px]:grid-cols-[1.7fr_1fr] min-[1024px]:gap-0 min-[1024px]:divide-x min-[1024px]:divide-line">
        {/* Left — table */}
        <div className="min-[1024px]:pr-8">
          <div className="scroll-x">
            <table className="w-full min-w-[680px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
                  <Th>#</Th>
                  <Th left>{entityHeader}</Th>
                  {showChain && <Th left>Chain</Th>}
                  <Th>Cards</Th>
                  <Th>24h Vol</Th>
                  <Th>Market Cap</Th>
                  <Th>Trades</Th>
                  <Th>Avg Trade</Th>
                  <Th>Holders</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const href = hrefBase && r.key !== "other" ? `${hrefBase}${r.key}` : null;
                  const chip = (
                    <span className="flex items-center gap-2.5 font-semibold">
                      <span
                        className="inline-flex h-6 w-6 items-center justify-center rounded-xl text-[10px] font-bold text-black"
                        style={{ background: r.color }}
                      >
                        {r.name.slice(0, 2).toUpperCase()}
                      </span>
                      {r.name}
                    </span>
                  );
                  return (
                  <tr
                    key={r.key}
                    onMouseEnter={() => setHover(r.key)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => href && router.push(href)}
                    className={`group border-b border-line/60 transition-colors hover:bg-bg-2 ${hover === r.key ? "bg-bg-2" : ""} ${href ? "cursor-pointer" : ""}`}
                  >
                    <Td className="text-ink-3">{String(i + 1).padStart(2, "0")}</Td>
                    <Td left>
                      {href ? (
                        <Link
                          href={href}
                          onClick={(e) => e.stopPropagation()}
                          className="group-hover:text-yellow"
                        >
                          {chip}
                        </Link>
                      ) : (
                        chip
                      )}
                    </Td>
                    {showChain && (
                      <Td left>
                        <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-2">
                          <span className="h-1.5 w-1.5 rounded-none" style={{ background: r.chainColor }} />
                          {r.chain}
                        </span>
                      </Td>
                    )}
                    <Td>{r.cards != null ? formatCompactNumber(r.cards) : "—"}</Td>
                    <Td strong>{formatCompactUsd(r.vol24Usd)}</Td>
                    <Td>{r.mcapUsd != null ? formatCompactUsd(r.mcapUsd) : "—"}</Td>
                    <Td>{formatInt(r.trades24h)}</Td>
                    <Td muted>{formatCompactUsd(r.avgTradeUsd)}</Td>
                    <Td>{r.holders != null ? formatInt(r.holders) : "—"}</Td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right — donut */}
        <div className="min-[1024px]:pl-8">
          <header className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-semibold text-ink-2">{donutTitle}</h3>
              <div className="mt-1 font-mono text-[12px] text-ink-3">% dominance</div>
            </div>
            <Dropdown value={metric} options={METRIC_OPTS} onChange={setMetric} />
          </header>
          <Donut shares={shares} hover={hover} setHover={setHover} metricLabel={METRIC_OPTS.find((o) => o.value === metric)!.label} />
        </div>
      </div>
    </Section>
  );
}

function Donut({
  shares,
  hover,
  setHover,
  metricLabel,
}: {
  shares: Array<PlatformRow & { share: number }>;
  hover: string | null;
  setHover: (k: string | null) => void;
  metricLabel: string;
}) {
  const r = 54;
  const C = 2 * Math.PI * r;
  const GAP = 2.5;
  let acc = 0;
  const segs = shares.map((s) => {
    const len = Math.max(0, s.share * C - GAP);
    const seg = { ...s, len, offset: -acc * C };
    acc += s.share;
    return seg;
  });
  const active = hover ? shares.find((s) => s.key === hover) : null;

  return (
    <div>
      <div className="relative mx-auto h-[160px] w-[160px]">
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
          <circle cx="70" cy="70" r={r} fill="none" stroke="var(--color-bg-2)" strokeWidth="22" />
          {segs.map((s) => (
            <circle
              key={s.key}
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={hover === s.key ? 26 : 22}
              strokeDasharray={`${s.len} ${C - s.len}`}
              strokeDashoffset={s.offset}
              className="cursor-pointer transition-[stroke-width,opacity]"
              style={{ opacity: hover && hover !== s.key ? 0.3 : 1 }}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-[24px] font-semibold tabular text-ink">
            {active ? `${Math.round(active.share * 100)}%` : "100%"}
          </span>
          <span className="mt-0.5 max-w-[110px] truncate text-center font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
            {active ? active.name : metricLabel}
          </span>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        {shares.map((s) => (
          <div
            key={s.key}
            onMouseEnter={() => setHover(s.key)}
            onMouseLeave={() => setHover(null)}
            className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 transition-colors ${hover === s.key ? "bg-bg-2" : ""}`}
          >
            <span className="h-2.5 w-2.5 rounded-md" style={{ background: s.color }} />
            <span className="flex-1 truncate text-[13px] text-ink-2">{s.name}</span>
            <span className="font-mono text-[13px] font-semibold tabular text-ink">
              {Math.round(s.share * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Th({ children, left }: { children: React.ReactNode; left?: boolean }) {
  return <th className={`px-3 py-3 font-medium ${left ? "text-left" : "text-right"}`}>{children}</th>;
}

function Td({
  children,
  left,
  strong,
  muted,
  className = "",
}: {
  children: React.ReactNode;
  left?: boolean;
  strong?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-3.5 font-mono tabular ${left ? "text-left" : "text-right"} ${
        strong ? "font-semibold text-ink" : muted ? "text-ink-3" : "text-ink-2"
      } ${className}`}
    >
      {children}
    </td>
  );
}
