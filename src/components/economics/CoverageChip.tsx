import type { CoverageCell } from "@/lib/data/economicsCoverage";
import { HeldChip } from "./HeldChip";

/**
 * One coverage cell, as a chip.
 *
 * Three states, one step of contrast between them and NO new colours: counted
 * carries `ink` on `bg-2`, a held cell defers to the existing <HeldChip> so a
 * hold looks the same here as it does in the KPI strip, and an absent source is
 * `ink-4` on the card's own ground — recessive, because "this venue has not
 * published a payout wallet" is a fact about coverage, not a failing grade.
 */
export function CoverageChip({ cell }: { cell: CoverageCell }) {
  if (cell.state === "held") return <HeldChip reasons={[cell.reason]} />;

  const counted = cell.state === "counted";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] leading-[1.5] ${
        counted ? "border-line-2 bg-bg-2 text-ink" : "border-line bg-bg-1 text-ink-4"
      }`}
    >
      {counted ? "counted" : "no source"}
    </span>
  );
}

/** "1 of 5 venues" — a section header's scope, in the chip family above. */
export function VenueCountChip({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-line-2 bg-bg-2 px-1.5 py-0.5 font-mono text-[10.5px] leading-[1.5] text-ink-3">
      {children}
    </span>
  );
}
