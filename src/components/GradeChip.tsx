import { parseGradeLabel, graderColor } from "@/lib/card/grade";

/**
 * The ONE grade chip: coloured grader + mono number ("PSA 10").
 *
 * Replaces three near-copies (PlatformTables / IPTables / IPTraitTables) that
 * had drifted apart in both palette and type scale. Takes the already-formatted
 * label the tables carry (`gradeLabel`) and parses it, so callers don't each
 * re-derive grader/number.
 *
 * Anything unparseable ("Ungraded", "") degrades to muted text rather than a
 * chip — a chip implies a grade we don't have.
 */
export function GradeChip({ label }: { label: string | null | undefined }) {
  const parsed = parseGradeLabel(label);
  if (!parsed) {
    return <span className="font-mono text-[12px] text-ink-3">{label || "—"}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-2 px-2 py-1 font-mono text-[11px] font-bold">
      <span style={{ color: graderColor(parsed.grader) }}>{parsed.grader}</span>
      <span className="text-ink">{parsed.grade}</span>
    </span>
  );
}
