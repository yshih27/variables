import Link from "next/link";
import type { BiggestPull } from "@/lib/data/venueBoards";
import { GACHA_ENABLED } from "@/lib/flags";
import { formatCompactUsd, formatMonthDayUtc } from "@/lib/format";
import { CardThumb } from "./CardThumb";
import { GradeChip } from "./GradeChip";
import { Section } from "./Section";

/**
 * Biggest pulls — the most valuable prizes a venue's pulls paid over 30 days,
 * from `PlatformDetail.biggestPulls` (readBiggestPulls: Renaiss, Collector
 * Crypt, Phygitals).
 *
 * ⚠️ EVERY VALUE IS IN ITS VENUE'S BASIS, AND SAYS SO. A Renaiss prize is worth
 * what Renaiss states, a Collector Crypt prize its insured value: the venue's own
 * claim, never a price. One receipt line under the table names the basis, and
 * each value's title repeats it, so a figure lifted out of the row keeps it.
 *
 * ⚠️ PULL TIMES ARE PRINTED AS UTC STAMPS, NOT AGES. The page is ISR-cached; a
 * server-rendered "3h ago" would freeze for the cache's life.
 *
 * Honest absence: null (no named pull feed) or an empty list renders nothing.
 */
export function PlatformBiggestPulls({ pulls }: { pulls: BiggestPull[] | null | undefined }) {
  if (!pulls || pulls.length === 0) return null;
  const bases = [...new Set(pulls.map((p) => p.valueBasis))];

  return (
    <Section
      id="biggest-pulls"
      className="scroll-mt-24 font-sans"
      title="Biggest pulls"
      readMe="the most valuable prizes pulled here in the last 30 days"
      subtitle={`Top ${pulls.length} by value · last 30 days`}
      right={
        GACHA_ENABLED ? (
          <Link href="/gacha" className="text-[12px] text-ink-3 transition-colors hover:text-yellow">
            Compare every venue →
          </Link>
        ) : undefined
      }
      flush
    >
      <div className="scroll-x">
        <table className="w-full min-w-[760px] border-collapse text-[13px]" data-biggest-pulls>
          <thead>
            <tr className="border-b border-line">
              <Th>#</Th>
              <Th>Card</Th>
              <Th>Grade</Th>
              <Th align="right">Value</Th>
              <Th>From</Th>
              <Th align="right">Pulled</Th>
            </tr>
          </thead>
          <tbody>
            {pulls.map((p, i) => (
              <tr key={`${p.pulledAt}-${i}`} className="[&:last-child>td]:border-b-0">
                <Td className="w-[44px] font-mono tabular text-ink-3">{String(i + 1).padStart(2, "0")}</Td>
                <Td>
                  <span className="flex items-center gap-3">
                    <CardThumb
                      src={p.image}
                      variant="cell"
                      alt={p.cardName ?? ""}
                      preview={p.cardName ? { name: p.cardName, grade: p.grade } : undefined}
                    />
                    <span className="block max-w-[320px] truncate font-semibold" title={p.cardName ?? undefined}>
                      {p.cardName ?? "—"}
                    </span>
                  </span>
                </Td>
                <Td>
                  <GradeChip label={p.grade} />
                </Td>
                <Td align="right" className="font-mono tabular font-semibold text-ink">
                  <span title={p.valueBasis}>{formatCompactUsd(p.valueUsd)}</span>
                </Td>
                <Td className="max-w-[220px] truncate text-[12px] text-ink-2">{p.machine ?? "—"}</Td>
                <Td align="right" className="font-mono tabular text-[12px] text-ink-3">
                  {pulledStamp(p.pulledAt)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] leading-snug text-ink-4" data-pull-basis>
        values are {bases.join("; ")}
      </p>
    </Section>
  );
}

/** "Oct 4 · 08:09 UTC" — a fixed stamp, so a cached page never shows a stale age. */
function pulledStamp(iso: string): string {
  const day = formatMonthDayUtc(iso);
  const t = Date.parse(iso);
  if (!day || !Number.isFinite(t)) return "—";
  const d = new Date(t);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} · ${hh}:${mm} UTC`;
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
