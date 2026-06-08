/**
 * Freshness view-model — turns raw `source_freshness` rows into the chip
 * models the UI renders. The honest "as of" layer, read side.
 *
 * `chipsFor([...])` powers the per-hero chips; `allChips()` powers /status.
 * The verdict (ok / stale / error / untracked) and the staleness threshold
 * come from `freshnessState` in db/freshness so the warmer, the
 * check-freshness script, and the UI can never disagree.
 */
import {
  readFreshness,
  freshnessState,
  SOURCE_INTERVALS_MS,
  type FreshnessRow,
  type FreshnessState,
} from "@/lib/db/freshness";

export type ChipModel = {
  source: string;
  label: string;
  state: FreshnessState;
  asOf: string | null;
  ageMs: number | null;
  rowsWritten: number | null;
  error: string | null;
};

/** Human-friendly labels per source (falls back to the raw key). */
const LABELS: Record<string, string> = {
  "core-volume": "Volume",
  marketcap: "Market cap",
  listings: "Listings / floor",
  "courtyard-primary": "Courtyard primary",
  "primary-revenue": "Primary revenue",
  history: "Price history",
  "gacha-dune": "Gacha",
  "cc-sales": "CC sales",
  holders: "Holders",
  "beezie-traits": "Beezie traits",
  phygitals: "Phygitals",
  "cc-traits": "CC traits",
};

export function labelFor(source: string): string {
  return LABELS[source] ?? source;
}

function toChips(sources: string[], rows: FreshnessRow[], now: number): ChipModel[] {
  const byId = new Map(rows.map((r) => [r.source, r]));
  return sources.map((source) => {
    const row = byId.get(source);
    const { state, ageMs } = freshnessState(source, row, now);
    return {
      source,
      label: labelFor(source),
      state,
      asOf: row?.generated_at ?? null,
      ageMs,
      rowsWritten: row?.rows_written ?? null,
      error: row?.error ?? null,
    };
  });
}

/** Chips for a specific set of sources, in the order given. */
export async function chipsFor(sources: string[], now: number = Date.now()): Promise<ChipModel[]> {
  const rows = await readFreshness(sources);
  return toChips(sources, rows, now);
}

/** Every known source (union of expected + recorded), for the /status page. */
export async function allChips(now: number = Date.now()): Promise<ChipModel[]> {
  const rows = await readFreshness();
  const sources = Array.from(
    new Set([...Object.keys(SOURCE_INTERVALS_MS), ...rows.map((r) => r.source)]),
  ).sort();
  return toChips(sources, rows, now);
}
