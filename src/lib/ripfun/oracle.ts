/**
 * The oracle contract — CardOS comps as CONTEXT, and the type system as the thing
 * that keeps them there.
 *
 * ═══ THE RULE THAT OVERRIDES EVERYTHING ═══
 * An oracle price is a THIRD-PARTY COMP. It must never feed V-MKT, any spine
 * metric, any market cap, or any realized-price series.
 *
 * The three numbers this site publishes mean three different things, and the
 * whole point of the index is that they stay apart:
 *   • the index  — constant-quality REALIZED prices, from sales that settled on
 *                  a chain we watch;
 *   • market cap — vault appraisal or floor × supply, per platform;
 *   • a comp     — what this card is worth elsewhere, per CardOS's blend of a
 *                  price feed and sold comps we cannot see.
 * Averaging a comp into the first is not a small inaccuracy: it silently swaps
 * "what the market paid here" for "what a vendor estimates", which is the exact
 * substitution the index exists to avoid.
 *
 * ⚠️ SO THE COMP IS NOT A `number`. It is an object, deliberately, and that is
 * the enforcement — not the comment above it. `total += comp` does not compile;
 * `total += comp.usd` is something a reviewer can see someone chose to write. A
 * branded number would not have done this: TypeScript happily adds branded
 * numbers together, so `Σ` would still typecheck. Nothing in this module returns
 * a bare number, and no reader here is shaped to sit on a platform bucket or a
 * spine row.
 *
 * Provenance rides ON the value rather than beside it, so a caller cannot pick up
 * the price and drop the attribution: every comp carries its source label and the
 * timestamp CardOS last recomputed it.
 */

/** The vendor label, verbatim, for anything that renders a comp. */
export const ORACLE_SOURCE = "CardOS comps" as const;

/**
 * One comp. Read `.usd` deliberately; never sum these.
 *
 * `kind` is CardOS's own `value_kind` and is load-bearing for display:
 *   • "sold"    — backed by recent sold comps
 *   • "blended" — the feed reconciled with a few comps
 *   • "feed"    — an ESTIMATE with no sales behind it
 * A "feed" value is a model output. Rendering it beside our realized prices
 * without saying so would put an estimate and a settled trade in one column.
 */
export type OracleComp = {
  readonly kind: "cardos-comp";
  readonly usd: number;
  readonly source: typeof ORACLE_SOURCE;
  /** CardOS's own recompute timestamp (ISO), carried through untouched. */
  readonly updated: string | null;
  /** "sold" | "blended" | "feed" — what the number is built on. */
  readonly basis: "sold" | "blended" | "feed" | "unknown";
  /** "high" | "med" | "low" — how much sold evidence backs it. */
  readonly confidence: "high" | "med" | "low" | "unknown";
  /** Recent (≤90d) sold comps behind the value; 0 means estimate-only. */
  readonly soldCount: number | null;
};

/** A graded rung: one grading company + grade, with its comp. */
export type OracleGradedRung = {
  /** Canonical grader via src/lib/card/grade.ts — BECKETT is already folded to BGS. */
  readonly grader: string;
  readonly grade: number;
  /** "PSA 10" — the SSOT's own label, so chips render identically everywhere. */
  readonly label: string;
  readonly comp: OracleComp;
};

/** Everything CardOS values for one printing. */
export type OraclePrinting = {
  readonly cardosId: string;
  readonly expansionId: string;
  /** Raw (ungraded) market comp, or null when CardOS has none. */
  readonly raw: OracleComp | null;
  readonly graded: readonly OracleGradedRung[];
  /** When OUR warmer last wrote this row (distinct from CardOS's `updated`). */
  readonly fetchedAt: string;
};

/** What a caller gets back, comp plus how old it is. */
export type OracleLookup = {
  readonly printing: OraclePrinting;
  /** The rung matching the requested grade, or null when that grade is unpriced. */
  readonly comp: OracleComp | null;
  /** True when `comp` is the raw market price because no grade was asked for. */
  readonly isRaw: boolean;
  /** Age of OUR snapshot in ms — the number a staleness chip should read. */
  readonly ageMs: number;
};

/**
 * Parse a money field.
 *
 * ⚠️ ACCEPTS BOTH NUMBER AND STRING ON PURPOSE. The Card Data API sends JSON
 * numbers today, but rip.fun's own wire convention on the gacha side is "money is
 * always a string, never a JSON number" — so the two halves of one vendor's API
 * disagree, and a parser that assumed either would break when the oracle is
 * pointed at the other. Strings are parsed ONCE, here at the edge; nothing
 * downstream ever does arithmetic on a string form.
 *
 * Rejects non-finite and negative values rather than coercing: `Number("")` is 0,
 * and a zero that came from an empty field is a fabricated free card.
 */
export function parseMoney(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Build a comp. The only constructor — so every comp carries its provenance. */
export function makeComp(input: {
  usd: number;
  updated?: string | null;
  basis?: string | null;
  confidence?: string | null;
  soldCount?: number | null;
}): OracleComp {
  const basis = input.basis === "sold" || input.basis === "blended" || input.basis === "feed" ? input.basis : "unknown";
  const confidence =
    input.confidence === "high" || input.confidence === "med" || input.confidence === "low"
      ? input.confidence
      : "unknown";
  return {
    kind: "cardos-comp",
    usd: input.usd,
    source: ORACLE_SOURCE,
    updated: input.updated ?? null,
    basis,
    confidence,
    soldCount: Number.isFinite(input.soldCount as number) ? (input.soldCount as number) : null,
  };
}
