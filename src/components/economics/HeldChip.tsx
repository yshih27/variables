import type { NetHeldReason } from "@/lib/metrics/outboundDisclosure";

/**
 * The hold, rendered as a receipt (economics-flagship-plan §1).
 *
 * ⚠️ HELD IS A STATE, NOT AN ABSENCE. The flows and the ratio beside this chip
 * are measured and shipping; what is withheld is the SUBTRACTION, because net is
 * ~5% of spend and a sub-1% error in the payout leg is levered ~20× into it. So
 * the chip names the reason rather than leaving a dash, and it never sits beside
 * a number — a surface that HAS a net does not render this.
 *
 * The four reason tokens are the contract (`NetHeldReason`); the sentences are
 * the explanation. Both ship: the token so the state matches the methodology and
 * is greppable, the sentence so a reader need not look it up.
 */
export const HELD_REASON_TEXT: Record<NetHeldReason, string> = {
  "spender-coverage":
    "the spender set behind R3 is not yet complete enough — it needs about 99%",
  reconciliation: "the counterparty split is known-wrong for this platform",
  unsourced: "no on-chain payout wallet exists, so there is nothing to compute",
  "awaiting-r3-basis": "the payout days are not yet proven to be on the R3 basis",
};

/** "unsourced" is not a hold — it is a permanent absence of the input. Labelled
 *  differently so a reader does not sit waiting for it to clear. */
function label(reason: NetHeldReason): string {
  return reason === "unsourced" ? "no payout source" : `held · ${reason}`;
}

export function HeldChip({
  reasons,
  className = "",
}: {
  /** Every distinct hold blocking this figure. Empty renders nothing. */
  reasons: NetHeldReason[];
  className?: string;
}) {
  if (reasons.length === 0) return null;
  const text = reasons.map((r) => `${r}: ${HELD_REASON_TEXT[r]}`).join(" · ");
  return (
    <span
      title={text}
      className={`inline-flex flex-wrap items-center gap-x-1.5 rounded-md border border-line-2 bg-bg-2 px-1.5 py-0.5 font-mono text-[10.5px] leading-[1.5] text-ink-3 ${className}`}
    >
      {reasons.map((r) => (
        <span key={r}>{label(r)}</span>
      ))}
    </span>
  );
}

/** The one-line explanation, for a KPI card's `sub` slot. */
export function heldSentence(reasons: NetHeldReason[]): string | null {
  if (reasons.length === 0) return null;
  return reasons.map((r) => HELD_REASON_TEXT[r]).join("; ");
}
