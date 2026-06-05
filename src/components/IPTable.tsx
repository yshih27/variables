import Link from "next/link";
import type { IPRow } from "@/lib/types";
import { Sparkline } from "./Sparkline";
import { IPIcon } from "./IPIcon";
import { formatCompactUsd, formatCompactNumber, formatPct, formatInt } from "@/lib/format";

type Props = {
  rows: IPRow[];
  /** Cap visible rows; remaining ones surface via the See all link. */
  maxRows?: number;
  /** Where the See all link points. Omit to hide the link. */
  seeAllHref?: string;
};

export function IPTable({ rows, maxRows, seeAllHref }: Props) {
  if (rows.length === 0) return null;
  const visible = maxRows ? rows.slice(0, maxRows) : rows;
  const overflow = rows.length - visible.length;
  return (
    <section className="mt-14">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.005em]">
            Top {visible.length} IPs{" "}
            <span className="font-normal text-ink-3">/ Categories</span>
          </h2>
          <div className="mt-1 text-[12px] text-ink-3">
            24h breakdown by IP across tracked platforms.
          </div>
        </div>
        {seeAllHref && overflow > 0 && (
          <Link
            href={seeAllHref}
            className="text-[12px] text-ink-3 transition-colors hover:text-yellow"
          >
            See all {rows.length} IPs →
          </Link>
        )}
      </div>

      <div className="scroll-x">
        <table className="w-full min-w-[1100px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line">
              <Th>#</Th>
              <Th>IP / Category</Th>
              <Th align="right">Market Cap</Th>
              <Th align="right">Cards</Th>
              <Th align="right">Holders</Th>
              <Th align="right">Avg Trade</Th>
              <Th align="right">24h Vol</Th>
              <Th align="right">24h Buyers</Th>
              <Th>24h Chart</Th>
              <Th>Top Card</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((ip) => (
              <tr
                key={ip.key}
                className="group relative cursor-pointer transition-colors hover:bg-bg-1"
              >
                <Td className="w-[44px] text-ink-3">
                  {String(ip.rank).padStart(2, "0")}
                </Td>
                <Td>
                  <Link
                    href={`/ip/${ip.key}`}
                    className="flex items-center gap-3 before:absolute before:inset-0 before:content-['']"
                  >
                    <IPIcon
                      name={ip.name}
                      short={ip.short}
                      color={ip.color}
                      logo={ip.logo}
                      iconBlendMode={ip.iconBlendMode}
                      emoji={ip.emoji}
                      size={32}
                    />
                    <span className="font-semibold group-hover:text-yellow">
                      {ip.name}
                    </span>
                  </Link>
                </Td>
                <Td align="right" strong>{formatMcap(ip.mcapUsd, ip.cards)}</Td>
                <Td align="right">{formatCompactNumber(ip.cards)}</Td>
                <Td align="right">{formatInt(ip.holders)}</Td>
                <Td align="right" muted>
                  {ip.trades24h > 0
                    ? formatCompactUsd(ip.vol24Usd / ip.trades24h)
                    : "—"}
                </Td>
                <Td align="right">{formatCompactUsd(ip.vol24Usd)}</Td>
                <Td align="right" muted>{formatInt(ip.buyers24h)}</Td>
                <Td>
                  <Sparkline data={ip.spark} trend={ip.trend} />
                </Td>
                <Td className="max-w-[280px] overflow-hidden text-ellipsis text-[12px] text-ink-2">
                  {ip.topCard ?? "—"}
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

/**
 * Suppress meaningless mcap values caused by tiny/sparse data:
 *   - NaN or non-finite → "—"
 *   - <$1,000 total mcap → "—" (e.g. Sneakers $4)
 *   - <5 cards in the IP → "—" (too few to be statistically meaningful)
 * Otherwise format normally.
 */
function formatMcap(mcap: number, cards: number): string {
  if (!Number.isFinite(mcap) || mcap < 1000 || cards < 5) return "—";
  return formatCompactUsd(mcap);
}
