import { readSnapshot } from "@/lib/db/snapshots";

/**
 * THE METHOD LEDGER — what changed, when, and what it did to the levels.
 *
 * ⚠️ RENDERED FROM DATA, NEVER FROM TYPED COPY. A method note in prose rots the
 * day the next method ships: the page keeps claiming a move nobody can check
 * against the series beside it. `warm-sale-panel` writes this snapshot from the
 * SHADOW build — the only run that holds both keyings — so the version, the
 * date, the summary and every before/after level here were measured.
 *
 * ⚠️ EMPTY MEANS ABSENT. With no records the method line under a chart and the
 * methodology page's section render NOTHING, rather than a placeholder that
 * says a method exists without being able to say which. Until the first cutover
 * run writes the snapshot, that is the honest state.
 */
export type MethodChangeEntity = {
  id: string;
  /** "2026-08" */
  month: string;
  levelBefore: number | null;
  levelAfter: number | null;
  identitiesBefore: number | null;
  identitiesAfter: number | null;
};

export type MethodChange = {
  /** "v4.2" */
  version: string;
  /** ISO — when the shadow build that measured this ran. */
  date: string;
  summary: string;
  entities: MethodChangeEntity[];
};

export type MethodLedger = {
  /** Newest first. */
  changes: MethodChange[];
  /** The version in force — the newest record's, or null with no records. */
  current: MethodChange | null;
};

const EMPTY: MethodLedger = { changes: [], current: null };

/**
 * The ledger, newest first. Never throws: a surface that shows a method line is
 * never the reason a page fails, and an unreadable snapshot is the same state
 * as no snapshot — no line.
 */
export async function readMethodChanges(): Promise<MethodLedger> {
  try {
    const snap = await readSnapshot<{ changes?: MethodChange[] }>("method-changes");
    const raw = Array.isArray(snap?.changes) ? snap!.changes! : [];
    const changes = [...raw]
      .filter((c) => c && typeof c.version === "string" && typeof c.date === "string")
      .sort((a, b) => b.date.localeCompare(a.date));
    return { changes, current: changes[0] ?? null };
  } catch {
    return EMPTY;
  }
}
