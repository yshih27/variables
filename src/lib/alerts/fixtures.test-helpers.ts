/** Shared fixtures for the alert tests (not a test file itself). */
import type { EntityRef, IdentityReading, SaleRef, VolumeReading } from "./signals";

export const NOW = "2026-09-24T06:00:00.000Z";
export const charizard: EntityRef = { type: "identity", key: "pokemon/base-set/4/charizard/psa-10", label: "Charizard · PSA 10", href: "/i/pokemon/base-set/4/charizard/psa-10" };
export const pokemon: EntityRef = { type: "ip", key: "pokemon", label: "Pokémon", href: "/ip/pokemon" };
export const beezie: EntityRef = { type: "platform", key: "beezie", label: "Beezie", href: "/platform/beezie" };
export const cc: EntityRef = { type: "platform", key: "collector-crypt", label: "Collector Crypt", href: "/platform/collector-crypt" };

export function identity(over: Partial<IdentityReading> = {}): IdentityReading {
  return {
    entity: charizard,
    floor: { priceUsd: 100, venue: "collector-crypt", plausible: true },
    reference: { priceUsd: 100, month: "2026-08", n: 4 },
    lastSale: { priceUsd: 95, ts: "2026-09-20T10:00:00.000Z" },
    listed: [{ cardId: "cc-A", venue: "collector-crypt", priceUsd: 100, source: "NATIVE" }],
    listingsAsOf: "2026-09-24T04:20:00.000Z",
    ...over,
  };
}

export function volume(over: Partial<VolumeReading> = {}): VolumeReading {
  return {
    entity: beezie,
    day: "2026-09-23T00:00:00.000Z",
    totalUsd: 240_000,
    resaleUsd: 40_000,
    packsUsd: 200_000,
    meanUsd: 100_000,
    window: { from: "2026-09-16T00:00:00.000Z", to: "2026-09-22T00:00:00.000Z", days: 7 },
    ...over,
  };
}

export const sale = (priceUsd: number, ts: string, over: Partial<SaleRef> = {}): SaleRef => ({
  cardId: `cc-${priceUsd}`,
  name: "Charizard · PSA 10",
  venue: "collector-crypt",
  priceUsd,
  ts,
  identitySlug: charizard.key,
  ip: "pokemon",
  ...over,
});
