/**
 * Honest per-source freshness chip — replaces the old "Live · Xs ago" badge
 * that showed cache-WRITE time. A chip reflects when the source last actually
 * succeeded (source_freshness.generated_at) and its verdict:
 *
 *   ok (green)   · refreshed within its expected cadence
 *   stale (yellow)· ran ok once but has missed 2+ cycles
 *   error (red)  · the warmer ran and threw (message in the tooltip)
 *   untracked (·) · no data for this source yet (e.g. a platform we don't track)
 *
 * `FreshnessChip` is presentational (takes a ChipModel). `FreshnessChips` is an
 * async server component that fetches and renders a row — drop it into any
 * server component.
 */
import { chipsFor, type ChipModel } from "@/lib/data/freshnessView";

const DOT: Record<ChipModel["state"], string> = {
  ok: "bg-green",
  stale: "bg-yellow",
  error: "bg-red",
  untracked: "bg-ink-4",
};

const TEXT: Record<ChipModel["state"], string> = {
  ok: "text-ink-3",
  stale: "text-yellow",
  error: "text-red",
  untracked: "text-ink-4",
};

function ageLabel(chip: ChipModel): string {
  if (chip.state === "untracked") return "not tracked";
  if (chip.state === "error") return "failed";
  if (chip.ageMs == null) return "—";
  const h = chip.ageMs / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(chip.ageMs / 60_000))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function tooltip(chip: ChipModel): string {
  return [
    chip.label,
    chip.state.toUpperCase(),
    chip.asOf ? `as of ${new Date(chip.asOf).toLocaleString()}` : "no data yet",
    chip.rowsWritten != null ? `${chip.rowsWritten} rows` : "",
    chip.error ? `error: ${chip.error}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function FreshnessChip({
  chip,
  showLabel = true,
}: {
  chip: ChipModel;
  showLabel?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[12px] ${TEXT[chip.state]}`}
      title={tooltip(chip)}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-none ${DOT[chip.state]}`} />
      {showLabel && <span className="text-ink-3">{chip.label}</span>}
      <span>{ageLabel(chip)}</span>
    </span>
  );
}

/** Async server component: fetch + render a row of chips for the given sources. */
export async function FreshnessChips({
  sources,
  showLabel = true,
}: {
  sources: string[];
  showLabel?: boolean;
}) {
  const chips = await chipsFor(sources);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {chips.map((chip) => (
        <FreshnessChip key={chip.source} chip={chip} showLabel={showLabel} />
      ))}
    </div>
  );
}
