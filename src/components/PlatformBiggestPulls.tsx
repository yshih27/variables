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
 * Crypt, Phygitals) — and Latest pulls, the newest named prizes (readLatestPulls:
 * Renaiss, whose pulls are stored row by row). One table renders both; `compact`
 * fits it to half a row when the two sit side by side.
 *
 * ⚠️ EVERY VALUE IS IN ITS VENUE'S BASIS, AND SAYS SO. A Renaiss prize is worth
 * what Renaiss states, a Collector Crypt prize its insured value: the venue's own
 * claim, never a price. One receipt line under the table names the basis, and
 * each value's title repeats it, so a figure lifted out of the row keeps it.
 *
 * ⚠️ PULL TIMES ARE PRINTED AS UTC STAMPS, NOT AGES. The page is ISR-cached; a
 * server-rendered "3h ago" would freeze for the cache's life. Latest pulls says
 * how recent its list is the same way: the newest pull's stamp, from the data.
 *
 * Honest absence: null (no named pull feed) or an empty list renders nothing.
 */
export function PlatformBiggestPulls({ pulls, compact = false }: { pulls: BiggestPull[] | null | undefined; compact?: boolean }) {
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
      <PullsTable pulls={pulls} compact={compact} ranked data="biggest-pulls" />
      <p className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] leading-snug text-ink-4" data-pull-basis>
        values are {bases.join("; ")}
      </p>
    </Section>
  );
}

export function PlatformLatestPulls({ pulls, compact = false }: { pulls: BiggestPull[] | null | undefined; compact?: boolean }) {
  if (!pulls || pulls.length === 0) return null;
  const bases = [...new Set(pulls.map((p) => p.valueBasis))];
  const newest = pulls.reduce((m, p) => (p.pulledAt > m ? p.pulledAt : m), pulls[0].pulledAt);

  return (
    <Section
      id="latest-pulls"
      className="scroll-mt-24 font-sans"
      title="Latest pulls"
      readMe="the newest prizes pulled here, newest first"
      subtitle={`Newest ${pulls.length} · through ${pulledStamp(newest)}`}
      flush
    >
      <PullsTable pulls={pulls} compact={compact} data="latest-pulls" />
      <p className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] leading-snug text-ink-4" data-latest-pulls-receipt>
        {`named prizes only: the venue's feed names a prize after the pull, so the newest pulls join the list once named · values are ${bases.join("; ")}`}
      </p>
    </Section>
  );
}

function PullsTable({ pulls, compact, ranked = false, data }: { pulls: BiggestPull[]; compact: boolean; ranked?: boolean; data: string }) {
  return (
    <div className="scroll-x">
      <table className={`w-full border-collapse text-[13px] ${compact ? "min-w-[480px]" : "min-w-[760px]"}`} data-pulls={data} data-biggest-pulls={ranked ? "" : undefined}>
        <thead>
          <tr className="border-b border-line">
            {ranked && !compact ? <Th>#</Th> : null}
            <Th compact={compact}>Card</Th>
            {compact ? null : <Th>Grade</Th>}
            <Th compact={compact} align="right">Value</Th>
            <Th compact={compact}>From</Th>
            <Th compact={compact} align="right">{compact ? "Pulled · UTC" : "Pulled"}</Th>
          </tr>
        </thead>
        <tbody>
          {pulls.map((p, i) => (
            <tr key={`${p.pulledAt}-${i}`} className="[&:last-child>td]:border-b-0">
              {ranked && !compact ? <Td className="w-[44px] font-mono tabular text-ink-3">{String(i + 1).padStart(2, "0")}</Td> : null}
              <Td compact={compact}>
                <span className="flex items-center gap-3">
                  <CardThumb
                    src={p.image}
                    variant="cell"
                    alt={p.cardName ?? ""}
                    preview={p.cardName ? { name: p.cardName, grade: p.grade } : undefined}
                  />
                  <span className="min-w-0">
                    <span className={`block truncate font-semibold ${compact ? "max-w-[190px]" : "max-w-[320px]"}`} title={p.cardName ?? undefined}>
                      {p.cardName ?? "—"}
                    </span>
                    {compact && p.grade ? (
                      <span className="mt-1 block">
                        <GradeChip label={p.grade} />
                      </span>
                    ) : null}
                  </span>
                </span>
              </Td>
              {compact ? null : (
                <Td>
                  <GradeChip label={p.grade} />
                </Td>
              )}
              <Td compact={compact} align="right" className="font-mono tabular font-semibold text-ink">
                <span title={p.valueBasis}>{formatCompactUsd(p.valueUsd)}</span>
              </Td>
              <Td compact={compact} className={`truncate text-[12px] text-ink-2 ${compact ? "max-w-[130px]" : "max-w-[220px]"}`}>
                {p.machine ?? "—"}
              </Td>
              <Td compact={compact} align="right" className="font-mono tabular text-[12px] text-ink-3">
                {compact ? pulledStamp(p.pulledAt, false) : pulledStamp(p.pulledAt)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Oct 4 · 08:09 UTC" — a fixed stamp, so a cached page never shows a stale age.
 *  `utc: false` drops the suffix where the column header carries it. */
function pulledStamp(iso: string, utc = true): string {
  const day = formatMonthDayUtc(iso);
  const t = Date.parse(iso);
  if (!day || !Number.isFinite(t)) return "—";
  const d = new Date(t);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} · ${hh}:${mm}${utc ? " UTC" : ""}`;
}

function Th({ children, align, compact = false }: { children: React.ReactNode; align?: "right"; compact?: boolean }) {
  return (
    <th
      className={`${compact ? "px-3" : "px-4"} py-3 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, align, className = "", compact = false }: { children: React.ReactNode; align?: "right"; className?: string; compact?: boolean }) {
  return (
    <td className={`whitespace-nowrap border-b border-line/60 ${compact ? "px-3 py-2.5" : "px-4 py-3"} ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}
