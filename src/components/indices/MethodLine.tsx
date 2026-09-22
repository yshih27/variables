import Link from "next/link";
import type { MethodLedger } from "@/lib/data/methodChanges";

/**
 * The method line — one receipt under every index chart.
 *
 *   method v4.2 since 22 Sep 2026 · identities keyed on canonical set and number · what changed →
 *
 * ⚠️ EVERY WORD OF IT IS DATA. The version, the date and the clause come from
 * the `method-changes` snapshot the shadow build wrote; nothing here is typed
 * copy that could outlive the method it describes.
 *
 * ⚠️ NO LEDGER, NO LINE. With no records this renders nothing at all — not a
 * placeholder, not "method: unknown". Until the first cutover run writes the
 * snapshot that is the honest state, and a chart with no method line is a chart
 * that has not been re-keyed.
 */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The summary's first sentence, which is where the shadow build puts what
 * changed. The rest is the measured detail, and it lives on the methodology
 * page — a chart's foot is not the place for three sentences of arithmetic.
 */
function clause(summary: string): string {
  const first = summary.split(/(?<=\.)\s/)[0] ?? summary;
  return first.replace(/\.$/, "").trim();
}

export function MethodLine({ ledger, className = "" }: { ledger: MethodLedger; className?: string }) {
  const c = ledger.current;
  if (!c) return null;
  return (
    <p className={`font-mono text-[10.5px] leading-snug text-ink-4 ${className}`}>
      method {c.version} since {dateLabel(c.date)} · {clause(c.summary)} ·{" "}
      <Link href="/methodology#method-changes" className="text-ink-3 underline-offset-2 transition-colors hover:text-yellow hover:underline">
        what changed →
      </Link>
    </p>
  );
}
