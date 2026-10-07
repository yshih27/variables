import { PLATFORM_SOURCES } from "@/lib/data/sources";
import type { GachaPack } from "@/lib/data/gachaPacksCache";
import type { GachaVenueRecord } from "@/lib/data/fetchGacha";

/**
 * THE VENUES ON /gacha — which rows the matrix draws, what each venue's product
 * is called, and which venues it does not cover and why.
 *
 * ⚠️ FROM DATA, NEVER A HARD-CODED THREE. The payload's `venues` list (backend
 * PR B) is the source; until it ships, the rows are the venues that actually
 * have packs in the payload, busiest first, with no kind label (the page does
 * not guess what a venue sells) and no coverage line (it cannot know who is
 * missing). Names, codes and chains come from the platform registry.
 */
export type VenueKind = GachaVenueRecord["kind"];

export type GachaVenue = {
  key: string;
  name: string;
  /** Two-character registry monogram (the rail's tile), never a one-letter badge. */
  code: string;
  chain: string;
  kind: VenueKind | null;
  covered: boolean;
  reason: string | null;
};

/** What a venue's product is called, singular and plural. Beezie's is the Claw. */
export const KIND_WORD: Record<VenueKind, { one: string; many: string }> = {
  pack: { one: "Pack", many: "packs" },
  machine: { one: "Machine", many: "machines" },
  claw: { one: "Claw", many: "claws" },
  box: { one: "Box", many: "boxes" },
};

function registry(key: string) {
  return PLATFORM_SOURCES.find((p) => p.key === key) ?? null;
}

export function venuesOf(records: GachaVenueRecord[] | undefined, packs: GachaPack[]): GachaVenue[] {
  if (records?.length) {
    return records.map((v) => {
      const r = registry(v.key);
      return {
        key: v.key,
        name: v.name || r?.name || v.key,
        code: r?.railCode ?? v.key.slice(0, 2).toUpperCase(),
        chain: r?.chain ?? "",
        kind: v.kind,
        covered: v.covered,
        reason: v.reason ?? null,
      };
    });
  }
  // Fallback: the venues the packs carry, ordered by their 24h pulls.
  const pulls = new Map<string, number>();
  for (const p of packs) pulls.set(p.platform, (pulls.get(p.platform) ?? 0) + (p.pulls24h ?? 0));
  return [...pulls.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => {
      const r = registry(key);
      const sample = packs.find((p) => p.platform === key);
      return {
        key,
        name: r?.name ?? sample?.platformName ?? key,
        code: r?.railCode ?? sample?.platformShort ?? key.slice(0, 2).toUpperCase(),
        chain: r?.chain ?? sample?.chain ?? "",
        kind: null,
        covered: true,
        reason: null,
      };
    });
}

/** "Courtyard: <reason> · DYLI: <reason>" — the one coverage line under the matrix. */
export function coverageLine(venues: GachaVenue[]): string | null {
  const out = venues.filter((v) => !v.covered);
  if (!out.length) return null;
  return out.map((v) => `${v.name}: ${v.reason ?? "not covered"}`).join(" · ");
}

/** The h1/metadata's list of kinds, from the covered venues when known. */
export function kindsPhrase(venues: GachaVenue[]): string {
  const kinds = [...new Set(venues.filter((v) => v.covered && v.kind).map((v) => KIND_WORD[v.kind!].many))];
  return kinds.length ? kinds.join(", ").replace(/, ([^,]*)$/, " and $1") : "packs, machines, claws and boxes";
}
