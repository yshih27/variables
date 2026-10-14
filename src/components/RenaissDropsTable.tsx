import { DROP_MAX_SPAN_MS, DROP_MIN_PACKS, DROP_SETTLE_MS, type RenaissDrops } from "@/lib/renaiss/drops";
import { formatMonthDayUtc } from "@/lib/format";
import { Section } from "./Section";

/**
 * Renaiss's limited drops, newest first (`renaiss-drops`): each one-time pack's
 * run, how long its last pack took, and who bought it.
 *
 * ⚠️ INFERRED, AND SAYS SO. Renaiss publishes no drop calendar or supply; the
 * receipt line states the rule (src/lib/renaiss/drops.ts) and how far back the
 * history reaches, since "bought an earlier drop" can only count drops in it.
 *
 * ⚠️ NOT RENDERED: topBuyersSharePct. How concentrated a drop's buying is stays
 * private to Renaiss (owner's call, Oct 14 2026); the snapshot keeps it.
 */
const span = (fromIso: string, toIso: string): string => {
  const mins = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${String(mins % 60).padStart(2, "0")}m` : `${mins}m`;
};
const share = (n: number, of: number) => (of > 0 ? ` · ${Math.round((100 * n) / of)}%` : "");
const hours = (ms: number) => `${Math.round(ms / 3_600_000)} hours`;

export function RenaissDropsTable({ snap }: { snap: RenaissDrops | null | undefined }) {
  if (!snap?.drops?.length) return null;
  const drops = snap.drops;
  const oldest = drops[drops.length - 1];

  return (
    <Section
      id="drops"
      className="scroll-mt-24 font-sans"
      title="Limited drops"
      readMe="one-time packs that sold their whole run within a day: how fast, and who bought"
      subtitle={`${drops.length} drops since ${formatMonthDayUtc(oldest.firstAt)} · newest first`}
      flush
    >
      <div className="scroll-x">
        <table className="w-full min-w-[800px] border-collapse text-[13px]" data-drops>
          <thead>
            <tr className="border-b border-line">
              <Th>Drop</Th>
              <Th align="right">Price</Th>
              <Th align="right">Packs</Th>
              <Th align="right">Last pack after</Th>
              <Th align="right">Buyers</Th>
              <Th align="right">First-time players</Th>
              <Th align="right">Bought an earlier drop</Th>
            </tr>
          </thead>
          <tbody>
            {drops.map((d) => (
              <tr key={d.productId} className="[&:last-child>td]:border-b-0">
                <Td>
                  <span className="font-semibold text-ink">{d.named ? d.name : "Unnamed pack"}</span>
                  <span className="ml-2 font-mono text-[11px] tabular text-ink-3">{formatMonthDayUtc(d.firstAt)}</span>
                </Td>
                <Td align="right" className="font-mono tabular text-ink-2">
                  {d.priceUsd == null ? "—" : `$${d.priceUsd}`}
                </Td>
                <Td align="right" className="font-mono tabular text-ink">
                  {d.packs.toLocaleString("en-US")}
                </Td>
                <Td align="right" className="font-mono tabular font-semibold text-ink">
                  {span(d.firstAt, d.lastAt)}
                </Td>
                <Td align="right" className="font-mono tabular text-ink-2">
                  {d.buyers.toLocaleString("en-US")}
                </Td>
                <Td align="right" className="font-mono tabular text-ink-2">
                  {`${d.newPlayers.toLocaleString("en-US")}${share(d.newPlayers, d.buyers)}`}
                </Td>
                <Td align="right" className="font-mono tabular text-ink-2">
                  {`${d.returningBuyers.toLocaleString("en-US")}${share(d.returningBuyers, d.buyers)}`}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] leading-snug text-ink-4" data-drops-receipt>
        {`a drop is a pack whose ${DROP_MIN_PACKS}+ paid pulls all came within ${hours(DROP_MAX_SPAN_MS)} of its first, listed once ${hours(DROP_SETTLE_MS)} more pass with no sale: inferred from the pulls, Renaiss publishes no supply · buyers are wallets · first-time = the wallet's first Renaiss pull was in that drop · earlier drops are counted from ${formatMonthDayUtc(snap.historyFrom)} on`}
      </p>
    </Section>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`px-4 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, align, className = "" }: { children: React.ReactNode; align?: "right"; className?: string }) {
  return (
    <td className={`whitespace-nowrap border-b border-line/60 px-4 py-3 ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}
