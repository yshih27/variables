import type { EconomicsBoard, EconomicsPlatform } from "@/lib/types";
import type { NetHeldReason } from "@/lib/metrics/outboundDisclosure";

/**
 * What can be counted, venue by leg — derived from the board, never typed.
 *
 * ⚠️ THIS IS A PROJECTION, NOT A READ. Every cell is decided from fields the
 * board already carries; the module adds no query, no snapshot and no fetch. It
 * exists so the KPI strip's labels, the ratio zone's chip and the coverage matrix
 * cannot disagree about how many venues a leg is counted at — the honesty problem
 * on this page was three surfaces each asserting a scope on their own.
 *
 * ⚠️ THE COUNTS MOVE THEMSELVES. When a second venue's payout wallet becomes
 * countable, `outbound` goes 1 → 2 here and every label that reads it follows,
 * including the one that names a single venue by name and then stops doing so.
 */

/** The four legs a venue can expose. Order is the matrix's column order. */
export const COVERAGE_LEGS = ["spend", "outbound", "players", "partners"] as const;
export type CoverageLeg = (typeof COVERAGE_LEGS)[number];

export const COVERAGE_LEG_LABEL: Record<CoverageLeg, string> = {
  spend: "spend",
  outbound: "outbound",
  players: "players",
  partners: "partner attribution",
};

/**
 * One cell.
 *
 * `held` and `none` are DIFFERENT STATES and the difference is the whole point:
 * held means the input exists and the number is withheld pending work we can
 * name, none means there is no input to withhold. Collapsing them into one grey
 * cell would read as blame for venues that simply publish less.
 */
export type CoverageCell =
  | { state: "counted" }
  | { state: "held"; reason: NetHeldReason }
  | { state: "none" };

export type CoverageRow = {
  key: string;
  name: string;
  cells: Record<CoverageLeg, CoverageCell>;
};

export type EconomicsCoverage = {
  rows: CoverageRow[];
  /** Every tracked venue, counted or not — the denominator in every label. */
  venues: number;
  counted: Record<CoverageLeg, number>;
  /** Names of the venues a leg IS counted at, so a label can name a lone one. */
  countedNames: Record<CoverageLeg, string[]>;
};

const COUNTED: CoverageCell = { state: "counted" };
const NONE: CoverageCell = { state: "none" };

function spendCell(p: EconomicsPlatform): CoverageCell {
  // The SERIES is the evidence, not the sum: a venue with a working source and a
  // genuinely quiet 30 days has days, and must not read as "no source".
  return p.spendDaily.length > 0 ? COUNTED : NONE;
}

function outboundCell(p: EconomicsPlatform): CoverageCell {
  if (p.outbound30d != null) return COUNTED;
  // ⚠️ Suppression is a RECONCILIATION hold by definition (outboundDisclosure.ts):
  // the wallet exists and the flow is measured, the counterparty split is
  // known-wrong. So it never borrows the "unsourced" reason, whose chip reads
  // "no payout source" and would deny a wallet this venue actually has.
  if (p.disclosure === "suppressed") {
    return { state: "held", reason: p.heldReason && p.heldReason !== "unsourced" ? p.heldReason : "reconciliation" };
  }
  return NONE;
}

export function economicsCoverage(board: EconomicsBoard): EconomicsCoverage {
  const rows: CoverageRow[] = board.platforms.map((p) => ({
    key: p.key,
    name: p.name,
    cells: {
      spend: spendCell(p),
      outbound: outboundCell(p),
      players: p.players != null ? COUNTED : NONE,
      partners: p.partnerAttributedPct != null ? COUNTED : NONE,
    },
  }));

  const counted = {} as Record<CoverageLeg, number>;
  const countedNames = {} as Record<CoverageLeg, string[]>;
  for (const leg of COVERAGE_LEGS) {
    const hit = rows.filter((r) => r.cells[leg].state === "counted");
    counted[leg] = hit.length;
    countedNames[leg] = hit.map((r) => r.name);
  }

  return { rows, venues: rows.length, counted, countedNames };
}

/**
 * "5 venues" when a leg is counted everywhere, "counted at 1 of 5 venues" when it
 * is not. The asymmetry is deliberate: a complete leg needs a scope, an
 * incomplete one needs a confession.
 */
export function legScope(cov: EconomicsCoverage, leg: CoverageLeg): string {
  const n = cov.counted[leg];
  const t = cov.venues;
  if (t === 0) return "no venues";
  if (n === t) return `${t} ${t === 1 ? "venue" : "venues"}`;
  return `counted at ${n} of ${t} venues`;
}

/** The same scope, but naming the venue while there is exactly one to name. */
export function legVenueScope(cov: EconomicsCoverage, leg: CoverageLeg): string {
  const names = cov.countedNames[leg];
  return names.length === 1 ? names[0] : legScope(cov, leg);
}

/** The bare "1 of 5 venues" a header chip carries. */
export function legCountChip(cov: EconomicsCoverage, leg: CoverageLeg): string {
  return `${cov.counted[leg]} of ${cov.venues} venues`;
}
