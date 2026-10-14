/**
 * A venue's boxes on its own platform page: every box in the /gacha catalog for
 * a venue with no machine board, busiest first. Read from the same cached
 * payload /gacha draws (getGachaData), with medians already through the
 * plausibility gate, so the two pages can never disagree.
 *
 * ⚠️ DYLI ONLY FOR NOW. DYLI's feed carries a stated expected value per box and
 * a realized value per pull, so its catalog stands as a board on its own. Other
 * venues without a machine board (Phygitals, Beezie, Courtyard) carry different
 * fields in the catalog and need their own review before they join.
 */
import type { GachaPack, GachaPacksSnapshot } from "./gachaPacksCache";
import { getGachaData } from "./fetchGacha";

export const BOX_TABLE_VENUES: ReadonlySet<string> = new Set(["dyli"]);

export type VenueBoxes = {
  packs: GachaPack[];
  window: GachaPacksSnapshot["window"] | null;
  generatedAt: string | null;
};

/** A venue's boxes, busiest first over the trailing 7 days, then cheapest first. Pure. */
export function boxRows(packs: GachaPack[], venue: string): GachaPack[] {
  return packs
    .filter((p) => p.platform === venue)
    .sort((a, b) => (b.pulls7d ?? -1) - (a.pulls7d ?? -1) || a.priceUsd - b.priceUsd || a.name.localeCompare(b.name));
}

/** A venue's boxes, or null for a venue without a box table or an empty catalog. Never throws. */
export async function readVenueBoxes(key: string): Promise<VenueBoxes | null> {
  if (!BOX_TABLE_VENUES.has(key)) return null;
  try {
    const data = await getGachaData();
    const packs = boxRows(data.packs ?? [], key);
    return packs.length ? { packs, window: data.packsWindow ?? null, generatedAt: data.generatedAt ?? null } : null;
  } catch {
    return null;
  }
}
