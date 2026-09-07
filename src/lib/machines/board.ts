import type { MachineRow } from "@/lib/data/playerAnalytics";
import { PALETTE } from "@/lib/studio/catalog";

/**
 * Pure logic behind the Machines table — sorting, the raw-key test, and the
 * per-slug colour assignment.
 *
 * Kept out of the component so it can be exercised directly. That matters more
 * than usual here: the `topPartner: null` branch is currently unreachable in live
 * data (every machine carries at least one attributed pull), so a fixture is the
 * only way to know it works before the day it fires.
 */

export type MachineSortKey = "name" | "price" | "spend" | "pulls" | "spend7d" | "attributed";

/** A machine's attributed share of its OWN spend. NaN (→ "—") when it took none. */
export function attributedPct(r: MachineRow): number {
  return r.spendUsd > 0 ? (r.attributedUsd / r.spendUsd) * 100 : NaN;
}

export function valueFor(r: MachineRow, key: MachineSortKey): number {
  switch (key) {
    case "price":
      return r.priceUsd ?? NaN;
    case "spend":
      return r.spendUsd;
    case "pulls":
      return r.pulls;
    case "spend7d":
      return r.spend7dUsd;
    case "attributed":
      return attributedPct(r);
    case "name":
      return NaN; // string-compared in sortMachines
  }
}

/** Numeric compare; non-finite ALWAYS sinks, whichever way the column is sorted —
 *  the IPTable rule, so a "—" price never floats to the top of an ascending sort. */
export function cmp(a: number, b: number, dir: 1 | -1): number {
  const an = !Number.isFinite(a);
  const bn = !Number.isFinite(b);
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  return (a - b) * dir;
}

export function sortMachines(rows: MachineRow[], key: MachineSortKey, dir: 1 | -1): MachineRow[] {
  return [...rows].sort((a, b) =>
    key === "name" ? a.name.localeCompare(b.name) * dir : cmp(valueFor(a, key), valueFor(b, key), dir),
  );
}

/**
 * Is this row's `name` the catalog's, or the raw `product_id` standing in for one?
 *
 * ⚠️ ROUGHLY HALF THE ROWS ARE THE LATTER — the CC catalog lists 25 machines
 * against 48 in the pull data, so a machine rotated off the menu arrives with its
 * product code as its name and a null price. Setting `pokemon_5000` in the same
 * type as "Celestial Pokémon Gacha Pack" would present a database key as a
 * product name; the component renders these in mono instead.
 */
export function isRawKey(r: MachineRow): boolean {
  return r.name === r.key;
}

/** `collector-crypt:pokemon_5000` → `pokemon_5000`. The platform prefix is constant
 *  on this board (CC-only) and spends 16 characters saying so. */
export function shortKey(key: string): string {
  const i = key.indexOf(":");
  return i >= 0 ? key.slice(i + 1) : key;
}

/**
 * One colour per SLUG, stable across every row.
 *
 * Assigned by the partner's total spend across the whole board, not by its index
 * within a row — otherwise Jupiter would be blue on one machine and pink on the
 * next and the bars could not be read down the column. Colours come from the
 * existing house PALETTE; no new colours are introduced.
 */
export function colorBySlug(rows: MachineRow[]): Map<string, string> {
  const total = new Map<string, number>();
  for (const r of rows) {
    for (const p of r.partners) total.set(p.slug, (total.get(p.slug) ?? 0) + p.spendUsd);
  }
  return new Map(
    [...total.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([slug], i) => [slug, PALETTE[i % PALETTE.length]]),
  );
}
