/**
 * TableFoot — the row count under a table.
 *
 * ⚠️ IT STATES THREE NUMBERS, NOT ONE, because a single "N rows" is ambiguous
 * exactly where it matters. A table can be showing 4 of 12 because it is a
 * homepage teaser, or 4 of 12 because a chain facet is on — and a reader who
 * cannot tell those apart will read a filtered view as the whole market. So:
 * what is on screen, what the current filter holds, and (only when a filter is
 * actually narrowing) what the unfiltered set holds.
 */
export function TableFoot({
  shown,
  total,
  noun,
  filtered,
}: {
  shown: number;
  /** Rows the current filter holds (== total rows when nothing is filtered). */
  total: number;
  /** Singular; pluralised here. */
  noun: string;
  /** Unfiltered count — pass null when no filter is narrowing the set. */
  filtered?: number | null;
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
    </div>
  );
}
