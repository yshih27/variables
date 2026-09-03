import type { TapeItem } from "@/lib/types";

/**
 * DEV-ONLY tape fixture — see the gate in `tape.ts`. It never reaches a
 * production build.
 *
 * Deliberately shaped to exercise the cases that are easy to get wrong rather
 * than to look pretty: a sale with no USD leg (`valueUsd: null`), an index close
 * carrying a real delta, a gacha pull, an event right at the 24h boundary that
 * must be dropped, and a spread of ages so the relative-time formatter is
 * exercised across minutes, hours and the "23h" edge.
 *
 * Timestamps are relative to call time, so the fixture stays fresh instead of
 * ageing out of the window the moment it is written.
 */
export function TAPE_FIXTURE(): TapeItem[] {
  const now = Date.now();
  const ago = (mins: number) => new Date(now - mins * 60_000).toISOString();
  return [
    { id: "s1", ts: ago(2), kind: "sale", label: "2024 Black Star Promo Lapras · PSA 10", valueUsd: 2480, valueText: "$2.48K", platform: "collector-crypt", href: "/card/cc-1" },
    { id: "i1", ts: ago(11), kind: "index", label: "V-MKT closed 231.01", valueUsd: null, valueText: "231.01", href: "/ips", deltaPct: 10.9 },
    { id: "s2", ts: ago(24), kind: "sale", label: "2022 #001 Monkey D. Luffy · BGS 9.5", valueUsd: 940, valueText: "$940", platform: "beezie", href: "/card/bz-21491" },
    { id: "p1", ts: ago(48), kind: "pull", label: "Sealed Wax rip · Courtyard", valueUsd: 310, valueText: "$310", platform: "courtyard", href: "/platform/courtyard" },
    { id: "s3", ts: ago(96), kind: "sale", label: "1996 #090 Bandai Carddass Pikachu", valueUsd: null, valueText: "—", platform: "collector-crypt", href: "/card/cc-2" },
    { id: "i2", ts: ago(180), kind: "index", label: "V-TCG closed 118.4", valueUsd: null, valueText: "118.4", href: "/ips", deltaPct: -1.2 },
    { id: "s4", ts: ago(400), kind: "sale", label: "2023 Donruss Net Marvels Shrader", valueUsd: 1180, valueText: "$1.18K", platform: "beezie", href: "/card/bz-6908" },
    { id: "s5", ts: ago(1380), kind: "sale", label: "23h-old sale · still inside the window", valueUsd: 205, valueText: "$205", platform: "beezie", href: "/card/bz-6701" },
    // ⚠️ Past the 24h live window — normalizeTape MUST drop this one.
    { id: "s6", ts: ago(1500), kind: "sale", label: "25h-old sale · must not appear", valueUsd: 999, valueText: "$999", platform: "beezie", href: "/card/bz-1" },
  ];
}
