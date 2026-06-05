import type { GachaPlatformRow } from "@/lib/data/fetchGacha";
import { formatCompactUsd } from "@/lib/format";

/**
 * House Take — the "verify the house" panel. For platforms whose buyback is
 * visible on-chain, shows what players spent, what they got back, and what the
 * house actually kept (net revenue) — none of it the platform's own marketing.
 */
export function GachaHouseTake({ rows }: { rows: GachaPlatformRow[] }) {
  const withData = rows.filter((r) => r.netRevenue7d != null);
  if (withData.length === 0) return null;

  return (
    <section className="mt-12">
      <div className="mb-1 flex items-baseline gap-2">
        <h2 className="text-[22px] font-semibold tracking-[-0.005em]">House Take</h2>
        <span className="text-[12px] text-ink-3">· last 7d · measured on-chain</span>
      </div>
      <p className="mb-5 max-w-[640px] text-[12.5px] text-ink-3">
        What players spent, what they cashed back out, and what the house
        actually kept.
      </p>

      <div className="scroll-x">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line">
              <Th>Platform</Th>
              <Th align="right">Players Spent</Th>
              <Th align="right">Paid Back</Th>
              <Th align="right">Net (House Kept)</Th>
              <Th align="right">House Take</Th>
              <Th align="right">Cashed Out</Th>
            </tr>
          </thead>
          <tbody>
            {withData.map((r) => {
              const spent = (r.netRevenue7d ?? 0) + (r.buybackPayout7d ?? 0);
              const rateSane = r.buybackRate7d != null && r.buybackRate7d <= 1.1;
              return (
                <tr key={r.key} className="transition-colors hover:bg-bg-1">
                  <Td>
                    <span className="flex items-center gap-2.5 font-semibold">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-bg-2 text-[11px] font-bold">
                        {r.short}
                      </span>
                      {r.name}
                    </span>
                  </Td>
                  <Td align="right" muted>{formatCompactUsd(spent)}</Td>
                  <Td align="right" muted>{formatCompactUsd(r.buybackPayout7d ?? 0)}</Td>
                  <Td align="right" strong yellow>{formatCompactUsd(r.netRevenue7d ?? 0)}</Td>
                  <Td align="right" strong>
                    {r.houseTakePct != null ? `${(r.houseTakePct * 100).toFixed(1)}%` : "—"}
                  </Td>
                  <Td align="right" muted>
                    {rateSane ? `${(r.buybackRate7d! * 100).toFixed(1)}%` : "—"}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 text-[11px] text-ink-4">
        Net = spent − paid back. &quot;Cashed out&quot; = share of pulls instantly
        sold back to the house. Platforms without an on-chain buyback wallet are
        omitted.
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
  strong,
  muted,
  yellow,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  strong?: boolean;
  muted?: boolean;
  yellow?: boolean;
}) {
  const a = align === "right" ? "text-right" : "";
  const w = yellow
    ? "font-semibold text-yellow"
    : strong
    ? "font-semibold text-ink"
    : muted
    ? "text-ink-2"
    : "";
  return (
    <td className={`tabular whitespace-nowrap border-b border-line/60 px-4 py-4 ${a} ${w}`}>
      {children}
    </td>
  );
}
