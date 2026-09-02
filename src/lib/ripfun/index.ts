/**
 * Shared entry point for the CardOS oracle — the expansion index fetch both the
 * mapping pass and any future pass needs, kept here so the two cannot disagree
 * about how many credits an index costs or which languages it covers.
 */
import { fetchExpansionsPage, type RipFunExpansion, type RipFunGame } from "./catalog";
import { buildExpansionIndex, type ExpansionIndex } from "./expansions";
import { chargeMonthly } from "./meter";

/** Worst-case pages for one game's index at language=all (464 pokemon rows today). */
export const EXPANSION_INDEX_PAGES = 6;

/**
 * Both games' expansion indexes, at `language=all`.
 *
 * ⚠️ `language=all` OR HALF THE INVENTORY IS INVISIBLE — measured 2026-09-02, the
 * English default returns 203 Pokémon expansions and `all` returns 464. Every
 * Japanese set we trade (Terastal Festival ex, Battle Partners, VSTAR Universe,
 * Japanese 151) lives only in the second number.
 */
export async function fetchExpansionIndexes(
  source: string,
  games: RipFunGame[] = ["pokemon", "onepiece"],
  log: (m: string) => void = () => {},
): Promise<Partial<Record<RipFunGame, ExpansionIndex>>> {
  const out: Partial<Record<RipFunGame, ExpansionIndex>> = {};
  for (const game of games) {
    const rows: RipFunExpansion[] = [];
    for (let page = 1; page <= EXPANSION_INDEX_PAGES; page++) {
      const res = await fetchExpansionsPage(game, { page, pageSize: 100, language: "all" });
      await chargeMonthly(source, 1);
      rows.push(...(res.data ?? []));
      if (!res.data?.length || rows.length >= (res.total_count ?? 0)) break;
    }
    log(`  ${game} expansion index: ${rows.length} expansions (all languages)`);
    out[game] = buildExpansionIndex(game, rows);
  }
  return out;
}
