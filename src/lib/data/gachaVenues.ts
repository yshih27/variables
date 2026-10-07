/**
 * The venues the /gacha comparison lists — data, so the page renders its rows
 * and its coverage line from the payload and never from a hard-coded three.
 *
 * Kinds, in the venues' own words: Collector Crypt runs MACHINES, Beezie runs
 * the Claw, Phygitals and Renaiss sell PACKS, DYLI sells BOXES. A venue is
 * `covered` when the payload carries at least one of its packs; otherwise its
 * `reason` says why, from what was measured.
 */
import { PLATFORM_SOURCES } from "./sources";
import type { GachaPack } from "./gachaPacksCache";

export type GachaVenueKind = "pack" | "machine" | "claw" | "box";

export type GachaVenue = {
  key: string;
  name: string;
  kind: GachaVenueKind;
  covered: boolean;
  /** Why a venue is not covered; absent when it is. */
  reason?: string;
};

export const VENUE_KIND: Record<string, GachaVenueKind> = {
  "collector-crypt": "machine",
  beezie: "claw",
  phygitals: "pack",
  renaiss: "pack",
  dyli: "box",
  courtyard: "pack",
};

/**
 * Why a venue with no pack rows is not in the matrix. Courtyard's was measured
 * Oct 7 2026: its /vending-machine page renders its machines client-side (no
 * price or odds in the served HTML), api.courtyard.io answers 403 to an
 * unauthenticated read, and Rarible's activity index carries its trades, not a
 * catalog — and a Courtyard row is never built from Dune aggregates.
 */
const UNCOVERED_REASON: Record<string, string> = {
  courtyard: "Courtyard publishes no pack catalog: its vending machines are rendered in its app, and its API does not serve them to an outside read",
};

/** The venue list for a payload's packs, pure. Every venue with a gacha, in registry order. */
export function gachaVenues(packs: Pick<GachaPack, "platform">[]): GachaVenue[] {
  const withPacks = new Set(packs.map((p) => p.platform));
  return PLATFORM_SOURCES.filter((s) => VENUE_KIND[s.key]).map((s) => {
    const covered = withPacks.has(s.key);
    return {
      key: s.key,
      name: s.name,
      kind: VENUE_KIND[s.key],
      covered,
      ...(covered ? {} : { reason: UNCOVERED_REASON[s.key] ?? `no ${s.name} ${VENUE_KIND[s.key]} is in this build's catalog` }),
    };
  });
}
