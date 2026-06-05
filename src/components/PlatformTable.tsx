import Link from "next/link";
import type { PlatformRow, Chain } from "@/lib/types";
import { Sparkline } from "./Sparkline";
import { formatCompactUsd, formatCompactNumber, formatInt } from "@/lib/format";

const CHAIN_DOT: Record<Chain, string> = {
  Polygon: "var(--color-purple)",
  Solana: "var(--color-solana)",
  Base: "var(--color-blue)",
  Ethereum: "#9aa6ff",
};

type Props = { rows: PlatformRow[] };

export function PlatformTable({ rows }: Props) {
  return (
    <section className="mt-14">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.005em]">Top Platforms</h2>
          <div className="mt-1 text-[12px] text-ink-3">
            Where the trading happens.
          </div>
        </div>
      </div>

      <div className="scroll-x">
        <table className="w-full min-w-[1000px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line">
              <Th>#</Th>
              <Th>Platform</Th>
              <Th>Chain</Th>
              <Th>Vault</Th>
              <Th align="right">24h Vol</Th>
              <Th align="right">7d Vol</Th>
              <Th align="right" title="Primary-market revenue (gacha / tokenization), 24h">
                Primary 24h
              </Th>
              <Th align="right" title="Unique wallets (buyers ∪ sellers) active in 24h">
                Active 24h
              </Th>
              <Th align="right" title="Unique cards traded in 24h">
                Cards 24h
              </Th>
              <Th align="right">Holders</Th>
              <Th align="right">Avg Trade</Th>
              <Th>24h Chart</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.key}
                className="group relative cursor-pointer transition-colors hover:bg-bg-1"
              >
                <Td className="w-[44px] text-ink-3">
                  {String(p.rank).padStart(2, "0")}
                </Td>
                <Td>
                  <Link
                    href={`/platform/${p.key}`}
                    className="flex items-center gap-2.5 font-semibold before:absolute before:inset-0 before:content-['']"
                  >
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-bg-2 text-[11px] font-bold">
                      {p.short}
                    </span>
                    <span className="group-hover:text-yellow">{p.name}</span>
                  </Link>
                </Td>
                <Td>
                  <span className="inline-flex h-[22px] items-center gap-1.5 text-[12px] text-ink-2">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: CHAIN_DOT[p.chain] }}
                    />
                    {p.chain}
                  </span>
                </Td>
                <Td muted>{p.vault ?? "—"}</Td>
                <Td align="right" strong>
                  {formatCompactUsd(p.vol24Usd)}
                </Td>
                <Td align="right" muted>
                  {Number.isFinite(p.vol7Usd) ? formatCompactUsd(p.vol7Usd) : "—"}
                </Td>
                <Td align="right">
                  {p.primaryUsd != null ? formatCompactUsd(p.primaryUsd) : "—"}
                </Td>
                <Td align="right">{formatInt(p.active24h)}</Td>
                <Td align="right">
                  {Number.isFinite(p.cards) && p.cards > 0
                    ? formatCompactNumber(p.cards)
                    : "—"}
                </Td>
                <Td align="right">{formatInt(p.holders)}</Td>
                <Td align="right">{formatCompactUsd(p.avgTradeUsd)}</Td>
                <Td>
                  {p.spark.length > 0 ? <Sparkline data={p.spark} trend={p.trend} /> : "—"}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({
  children,
  align,
  title,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  /** Native tooltip — shown on hover. */
  title?: string;
}) {
  return (
    <th
      title={title}
      className={`px-4 py-3 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 ${
        align === "right" ? "text-right" : "text-left"
      } ${title ? "cursor-help" : ""}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className = "",
  strong,
  muted,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  strong?: boolean;
  muted?: boolean;
}) {
  const alignCls = align === "right" ? "text-right" : "";
  const weightCls = strong ? "font-semibold text-ink" : muted ? "text-ink-2" : "";
  return (
    <td
      className={`tabular whitespace-nowrap border-b border-line/60 px-4 py-4 ${alignCls} ${weightCls} ${className}`}
    >
      {children}
    </td>
  );
}
