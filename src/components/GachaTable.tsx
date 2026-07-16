import Link from "next/link";
import type { GachaPlatformRow } from "@/lib/data/fetchGacha";
import type { Chain } from "@/lib/types";
import { TableRowLink } from "./TableRowLink";
import { formatCompactUsd, formatInt } from "@/lib/format";

const CHAIN_DOT: Record<Chain, string> = {
  Polygon: "var(--color-purple)",
  Solana: "var(--color-solana)",
  Base: "var(--color-blue)",
  Ethereum: "#9aa6ff",
};

function packPriceLabel(prices: number[]): string {
  if (prices.length === 0) return "Variable";
  if (prices.length <= 3) return prices.map((p) => `$${p}`).join(" · ");
  return `$${Math.min(...prices)} – $${Math.max(...prices)}`;
}

export function GachaTable({ rows }: { rows: GachaPlatformRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-12">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.005em]">
            Per-Platform Comparison
          </h2>
          <div className="mt-1 text-[12px] text-ink-3">
            Pull counts and pack-spend USD from on-chain transfers.
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
              <Th align="right">Pulls 24h</Th>
              <Th align="right">Volume 24h</Th>
              <Th align="right">Avg Pull</Th>
              <Th align="right">7d Volume</Th>
              <Th>Pack Prices</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <TableRowLink key={p.key} href={`/platform/${p.key}`}>
                <Td className="w-[44px] text-ink-3">
                  {String(p.rank).padStart(2, "0")}
                </Td>
                <Td>
                  <Link
                    href={`/platform/${p.key}`}
                    className="flex items-center gap-2.5 font-semibold"
                  >
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-none bg-bg-2 text-[11px] font-bold">
                      {p.short}
                    </span>
                    <span className="group-hover:text-yellow">{p.name}</span>
                  </Link>
                </Td>
                <Td>
                  <span className="inline-flex h-[22px] items-center gap-1.5 text-[12px] text-ink-2">
                    <span
                      className="h-1.5 w-1.5 rounded-none"
                      style={{ background: CHAIN_DOT[p.chain] }}
                    />
                    {p.chain}
                  </span>
                </Td>
                <Td align="right">
                  {p.pulls24h > 0 ? formatInt(p.pulls24h) : "—"}
                </Td>
                <Td align="right" strong>
                  {p.vol24Usd > 0 ? formatCompactUsd(p.vol24Usd) : "—"}
                </Td>
                <Td align="right" muted>
                  {p.avgPullUsd > 0 ? formatCompactUsd(p.avgPullUsd) : "—"}
                </Td>
                <Td align="right" muted>
                  {p.vol7Usd != null ? formatCompactUsd(p.vol7Usd) : "—"}
                </Td>
                <Td className="text-[12px] text-ink-2">
                  {packPriceLabel(p.packPrices)}
                </Td>
              </TableRowLink>
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
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-4 py-3 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 ${
        align === "right" ? "text-right" : "text-left"
      }`}
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
  const a = align === "right" ? "text-right" : "";
  const w = strong ? "font-semibold text-ink" : muted ? "text-ink-2" : "";
  return (
    <td
      className={`tabular whitespace-nowrap border-b border-line/60 px-4 py-4 ${a} ${w} ${className}`}
    >
      {children}
    </td>
  );
}
