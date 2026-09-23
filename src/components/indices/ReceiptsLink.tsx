import Link from "next/link";
import { receiptsHref, receiptMonth } from "@/lib/indices/receiptRoute";

/**
 * `receipts →` — the way from a published index point to the cards behind it.
 *
 * ⚠️ IT POINTS AT ONE MONTH, NOT AT "THE INDEX". A level is a chain of steps;
 * the receipt is for the step into a specific month, so every one of these
 * carries the point's own stamp. A chart with a crosshair passes the hovered
 * point's; a chart without one passes its latest published point.
 *
 * ⚠️ NO POINT, NO LINK. `ts` null renders nothing — a series that has published
 * nothing has no sample to show, and a dead link to an empty month would be
 * worse than no link.
 */
export function ReceiptsLink({
  entityId,
  ts,
  label = "receipts",
  className = "",
}: {
  entityId: string | null;
  ts: string | null;
  label?: string;
  className?: string;
}) {
  if (!entityId || !ts) return null;
  return (
    <Link
      href={receiptsHref(entityId, ts)}
      data-receipts-link
      title={`the identities behind the ${receiptMonth(ts)} step`}
      className={`font-mono text-[10.5px] text-ink-4 underline-offset-2 transition-colors hover:text-yellow hover:underline ${className}`}
    >
      {label} →
    </Link>
  );
}
