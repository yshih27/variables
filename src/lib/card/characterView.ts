import type { CharacterDetail, CharacterIndexGate, CharacterMonthly } from "@/lib/data/characterRollups";
import type { IdentityIndexPoint } from "@/lib/data/identityIndex";
import { monthShort } from "./identityView";

/**
 * The character page's READING rules — pure, shared by the header, the KPI
 * strip, the hero, the share card and the leaderboard, so no two zones disagree
 * about what "the index" is or why there is none.
 *
 * ⚠️ THE INDEX IS THE ENGINE'S OUTPUT OR NOTHING. `index` is `identityIndex()`
 * on the character's own identities, complete months only, published at the
 * broad floor (20 identities priced in the latest complete month, in two
 * months running). When it is null the KPI reads "—" and the hero draws
 * volume alone — never a flat line, never a level derived on this side.
 *
 * ⚠️ THE RUNNING MONTH IS PROVISIONAL EVERYWHERE. `monthly` carries it flagged
 * `partial`; it is drawn hollow with "Sep · provisional" beside it, and it is
 * in no CSV, no KPI and no share card.
 */

/** The latest published index point, or null. */
export function latestIndex(index: IdentityIndexPoint[] | null): IdentityIndexPoint | null {
  return index && index.length ? index[index.length - 1] : null;
}

/** Month-over-month change of the published index in percent, or null when
 *  the last two points are not adjacent calendar months (a withheld step is
 *  not "a month's move"). */
export function indexMoM(index: IdentityIndexPoint[] | null): number | null {
  if (!index || index.length < 2) return null;
  const a = index[index.length - 2], b = index[index.length - 1];
  if (!(a.value > 0) || !Number.isFinite(b.value)) return null;
  const da = new Date(a.ts), db = new Date(b.ts);
  const gap = (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db.getUTCMonth() - da.getUTCMonth());
  if (gap !== 1) return null;
  return (b.value / a.value - 1) * 100;
}

/**
 * Why there is no index, in the reader's own numbers. Below the floor:
 * "14 priced cards, 20 needed". Enough cards but not in two months running:
 * "30 priced cards, not two months running".
 */
export function indexGateText(gate: CharacterIndexGate): string {
  const cards = `${gate.priced} priced card${gate.priced === 1 ? "" : "s"}`;
  if (gate.held === "too-few-months") return `${cards}, not two months running`;
  return `${cards}, ${gate.needed} needed`;
}

/** "Charizard index · 5 months · thin" — for the header's mono line; null
 *  when no index is published. */
export function indexSummary(d: CharacterDetail): string | null {
  const idx = d.index;
  if (!idx || !idx.length) return null;
  const last = idx[idx.length - 1];
  return `${d.name} index · ${idx.length} month${idx.length === 1 ? "" : "s"}${last.thin ? " · thin" : ""}`;
}

/** "187 cards · 1,204 slabs · 3 venues · in 41 sets" — counted from the reader. */
export function characterLine(d: CharacterDetail): string {
  const sets = d.bySet.filter((s) => s.setKey).length;
  const n = (v: number) => v.toLocaleString("en-US");
  return [
    `${n(d.identities)} card${d.identities === 1 ? "" : "s"}`,
    `${n(d.slabs)} slab${d.slabs === 1 ? "" : "s"}`,
    `${d.venues.length} venue${d.venues.length === 1 ? "" : "s"}`,
    `in ${n(sets)} set${sets === 1 ? "" : "s"}`,
  ].join(" · ");
}

export function completeMonths(monthly: CharacterMonthly[]): CharacterMonthly[] {
  return monthly.filter((m) => !m.partial);
}

export function runningMonth(monthly: CharacterMonthly[]): CharacterMonthly | null {
  return monthly.find((m) => m.partial) ?? null;
}

/** "Sep · provisional · 129 sales" — the only words the page says about the running month. */
export function provisionalLabel(m: CharacterMonthly): string {
  return `${monthShort(m.ts)} · provisional · ${m.sales} sale${m.sales === 1 ? "" : "s"}`;
}

/** The leaderboard's two reader preferences, per IP (the machines table's pattern). */
export const CHARACTERS_ROWS_PREF = ["top", "all"] as const;
export const CHARACTERS_OPEN_PREF = ["open", "closed"] as const;
export type CharactersRowsPref = (typeof CHARACTERS_ROWS_PREF)[number];
export type CharactersOpenPref = (typeof CHARACTERS_OPEN_PREF)[number];
export function charactersPrefKey(ip: string, pref: "rows" | "open"): string {
  return `varible:characters:${ip}:${pref}`;
}
/** Rows a table shows by default, of the CURRENT sort. */
export const CHARACTER_TOP_ROWS = 15;
