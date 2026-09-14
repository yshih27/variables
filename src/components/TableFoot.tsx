/**
 * TableFoot — the row count under a table.
 *
 * ⚠️ IT STATES THREE NUMBERS, NOT ONE, because a single "N rows" is ambiguous
 * exactly where it matters. A table can be showing 4 of 12 because it is a
 * homepage teaser, or 4 of 12 because a chain facet is on — and a reader who
 * cannot tell those apart will read a filtered view as the whole market. So:
 * what is on screen, what the current filter holds, and (only when a filter is
 * actually narrowing) what the unfiltered set holds.
 *
 * `action` — the one control a foot may carry: a text button in the foot's own
 * type that changes how many rows the table shows ("Show all 53 →" / "Show top
 * 10"). It sits beside the count because the count is what it changes; a reader
 * who reads "showing 10 of 53" finds the way to the other 43 in the same glance.
 */
export function TableFoot({
  shown,
  total,
  noun,
  filtered,
  action,
}: {
  shown: number;
  /** Rows the current filter holds (== total rows when nothing is filtered). */
  total: number;
  /** Singular; pluralised here. */
  noun: string;
  /** Unfiltered count — pass null when no filter is narrowing the set. */
  filtered?: number | null;
  /** A row-limit control. Omit for a table that shows what it has. */
  action?: { label: string; onClick: () => void };
}) {
  const plural = (n: number) => (n === 1 ? noun : noun.endsWith("s") ? noun : `${noun}s`);
  return (
    <div className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] text-ink-4 sm:px-5">
      {shown === total ? (
        <>
          {total} {plural(total)}
        </>
      ) : (
        <>
          showing {shown} of {total} {plural(total)}
        </>
      )}
      {filtered != null && filtered !== total ? (
        <span className="text-ink-3">{` · filtered from ${filtered}`}</span>
      ) : null}
      {action ? (
        <>
          {" · "}
          <button
            type="button"
            onClick={action.onClick}
            className="cursor-pointer rounded-sm text-ink-3 transition-colors hover:text-yellow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
          >
            {action.label}
          </button>
        </>
      ) : null}
    </div>
  );
}
