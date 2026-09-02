/**
 * The two oracle snapshots, and the reader the frontend will import.
 *
 *   `ripfun-oracle-map`    printingKey → CardOS card id. Rebuilt on demand only —
 *                          set membership does not change, so a mapping earned
 *                          once is good until new sets start trading.
 *   `ripfun-oracle-prices` cardosId → the comp payload. Refreshed on a cadence.
 *
 * ⚠️ TWO STORES, NOT ONE, BECAUSE THEY HAVE DIFFERENT LIFETIMES AND DIFFERENT
 * PRICES. Mapping is the expensive part (a walk of every mapped expansion) and
 * almost never changes; prices are the same walk but only the payload changes.
 * Fusing them would mean re-deriving the mapping on every refresh, or worse,
 * treating a price refresh as authority to drop mappings it did not happen to
 * revisit — which is how half the map disappears on a budget-halted run.
 *
 * Both are UPSERT-MERGE, never replace: a pass that halts on the monthly budget
 * has still done real work, and the next run continues from what is there.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";
import { parseGradeLabel } from "../card/grade";
import {
  makeComp,
  type OracleComp,
  type OracleGradedRung,
  type OracleLookup,
  type OraclePrinting,
} from "./oracle";
import type { CardLang } from "./identity";

const MAP_KEY = "ripfun-oracle-map";
const PRICE_KEY = "ripfun-oracle-prices";

// ── Mapping store ─────────────────────────────────────────────────────────

/** One expansion we walk, and why it earned a slot in the budget. */
export type MappedExpansion = {
  game: "pokemon" | "onepiece";
  expansionId: string;
  name: string;
  lang: CardLang;
  /** Our own set strings that resolved here — the audit trail for the resolver. */
  setRaws: string[];
  /** 30d trades across those sets when the expansion was chosen. */
  trades: number;
  /** `total_count` CardOS reported, which is what its page cost is derived from. */
  cards: number;
  /** Pages walked last time — the refresh's own credit cost. */
  pages: number;
};

export type PrintingMapping = {
  cardosId: string;
  expansionId: string;
  game: "pokemon" | "onepiece";
  /** How the CARD matched inside the expansion: number+name, number, or name. */
  matchedOn: "number+name" | "number" | "name";
  /** CardOS's own name/number for the matched card — so a bad match is visible. */
  cardosName: string;
  cardosNumber: string | null;
};

export type OracleMap = {
  generatedAt: string;
  expansions: MappedExpansion[];
  /** printingKey (src/lib/ripfun/identity.ts) → the CardOS card it maps to. */
  printings: Record<string, PrintingMapping>;
  /** Printing keys we walked the right expansion for and still could not match —
   *  kept so the honest "no comp" count is a measured number, not an inference. */
  unmatched: string[];
};

export async function readOracleMap(): Promise<OracleMap | null> {
  return readSnapshot<OracleMap>(MAP_KEY).catch(() => null);
}

/** Merge new mappings into the stored map. Never drops what it did not revisit. */
export async function mergeOracleMap(patch: {
  expansions: MappedExpansion[];
  printings: Record<string, PrintingMapping>;
  unmatched: string[];
}): Promise<OracleMap> {
  const cur = (await readOracleMap()) ?? { generatedAt: "", expansions: [], printings: {}, unmatched: [] };
  const byExp = new Map(cur.expansions.map((e) => [`${e.game}:${e.expansionId}`, e]));
  for (const e of patch.expansions) byExp.set(`${e.game}:${e.expansionId}`, e);
  // A key that just matched is no longer unmatched — otherwise the honest
  // "no comp" count only ever grows, and would eventually describe nothing.
  const unmatched = new Set([...cur.unmatched, ...patch.unmatched]);
  for (const k of Object.keys(patch.printings)) unmatched.delete(k);
  const next: OracleMap = {
    generatedAt: new Date().toISOString(),
    expansions: [...byExp.values()].sort((a, b) => b.trades - a.trades),
    printings: { ...cur.printings, ...patch.printings },
    unmatched: [...unmatched].sort(),
  };
  await writeSnapshot(MAP_KEY, next, next.generatedAt);
  return next;
}

// ── Price store ───────────────────────────────────────────────────────────

/** Stored shape — plain JSON, rehydrated into OracleComp objects on read. */
export type StoredPrinting = {
  cardosId: string;
  expansionId: string;
  marketUsd: number | null;
  currency: string | null;
  /** CardOS's own recompute time. */
  updated: string | null;
  isStale: boolean | null;
  basis: string | null;
  confidence: string | null;
  soldCount: number | null;
  graded: {
    company: string;
    grade: string;
    valueUsd: number;
    basis: string | null;
    confidence: string | null;
    soldCount: number | null;
    lastSoldAt: string | null;
    /** p10/p90 + medians of the sold comps. ONLY the /prices detail route returns
     *  this, so it is absent on rows that have only ever ridden a card page. */
    band?: { median: number | null; recentMedian: number | null; p10: number | null; p90: number | null; count: number | null } | null;
  }[];
  /** When OUR warmer wrote it. */
  fetchedAt: string;
  /** When the richer /prices ladder last ran for this card. Absent = never; the
   *  graded rungs are then the compact ones a card page carries. Drives the
   *  ~monthly self-pacing of the ladder step. */
  laddersAt?: string | null;
};

export type OraclePrices = {
  generatedAt: string;
  byCardosId: Record<string, StoredPrinting>;
  /** expansionId → when we last refreshed it. Drives the alternating schedule. */
  refreshedAt: Record<string, string>;
};

export async function readOraclePrices(): Promise<OraclePrices | null> {
  return readSnapshot<OraclePrices>(PRICE_KEY).catch(() => null);
}

/**
 * Merge a refreshed slice in, then PRUNE to what the map actually references.
 *
 * ⚠️ THE PRUNE IS NOT TIDINESS, IT IS THE SIZE INVARIANT. A walked expansion
 * returns every printing in it — ~350-600 cards — while we map only the handful
 * our platforms trade. Storing the whole walk grew this snapshot to 9.1 MB across
 * 31 expansions, on a table where large jsonb upserts are already known to hit
 * PostgREST's statement_timeout (the listings snapshot died at 15 MB and had to be
 * gzip-wrapped). Bounding the store by the MAP keeps it proportional to what we
 * track — ~700 rows, well under a megabyte — instead of to CardOS's catalog.
 *
 * `keep` is passed by the caller because only it knows the mapping it just wrote.
 * When omitted nothing is pruned, so a caller that has not read the map cannot
 * accidentally empty the store.
 */
export async function mergeOraclePrices(patch: {
  printings: StoredPrinting[];
  refreshedExpansions: string[];
  /** CardOS ids the map references. Anything else is dropped. */
  keep?: ReadonlySet<string>;
}): Promise<OraclePrices> {
  const cur = (await readOraclePrices()) ?? { generatedAt: "", byCardosId: {}, refreshedAt: {} };
  const now = new Date().toISOString();
  for (const p of patch.printings) cur.byCardosId[p.cardosId] = p;
  for (const id of patch.refreshedExpansions) cur.refreshedAt[id] = now;
  if (patch.keep) {
    for (const id of Object.keys(cur.byCardosId)) if (!patch.keep.has(id)) delete cur.byCardosId[id];
  }
  cur.generatedAt = now;
  await writeSnapshot(PRICE_KEY, cur, now);
  return cur;
}

/** Every CardOS id the map points at — the `keep` set for the prune above. */
export function mappedCardosIds(map: OracleMap | null): Set<string> {
  return new Set(Object.values(map?.printings ?? {}).map((m) => m.cardosId));
}

// ── Reader contract ───────────────────────────────────────────────────────

function compFrom(row: StoredPrinting): OracleComp | null {
  if (row.marketUsd == null) return null;
  return makeComp({
    usd: row.marketUsd,
    updated: row.updated,
    basis: row.basis,
    confidence: row.confidence,
    soldCount: row.soldCount,
  });
}

function rungsFrom(row: StoredPrinting): OracleGradedRung[] {
  const out: OracleGradedRung[] = [];
  for (const g of row.graded ?? []) {
    // ⚠️ THROUGH THE SSOT, ALWAYS. CardOS labels a grading body the same way our
    // feeds do, "BECKETT" included — and BECKETT *is* BGS. Folding it anywhere but
    // src/lib/card/grade.ts is how one grader becomes two rungs of one ladder,
    // each with half the evidence.
    const parsed = parseGradeLabel(`${g.company ?? ""} ${g.grade ?? ""}`.trim());
    if (!parsed) continue;
    out.push({
      grader: parsed.grader,
      grade: parsed.grade,
      label: parsed.label,
      comp: makeComp({
        usd: g.valueUsd,
        updated: g.lastSoldAt ?? row.updated,
        basis: g.basis,
        confidence: g.confidence,
        soldCount: g.soldCount,
      }),
    });
  }
  return out.sort((a, b) => b.grade - a.grade || a.grader.localeCompare(b.grader));
}

function hydrate(row: StoredPrinting): OraclePrinting {
  return {
    cardosId: row.cardosId,
    expansionId: row.expansionId,
    raw: compFrom(row),
    graded: rungsFrom(row),
    fetchedAt: row.fetchedAt,
  };
}

/** Both snapshots, read once — pass to `getOraclePrice` for a batch of lookups. */
export type OracleBundle = { map: OracleMap | null; prices: OraclePrices | null };

export async function readOracleBundle(): Promise<OracleBundle> {
  const [map, prices] = await Promise.all([readOracleMap(), readOraclePrices()]);
  return { map, prices };
}

/**
 * The comp for one of OUR card types, with provenance and age.
 *
 * `printingKey` is the grade-free key from src/lib/ripfun/identity.ts; `grade` is
 * a label like "PSA 10" and is optional — omit it for the raw market comp.
 *
 * Returns null, not a zero, when anything is missing: unmapped printing, no
 * stored price, or a grade CardOS does not value. "No comp" is a real and
 * expected state for most of the catalog, and it renders as "—".
 */
export function getOraclePrice(
  bundle: OracleBundle,
  printingKey: string,
  grade?: string | null,
  now: number = Date.now(),
): OracleLookup | null {
  const mapping = bundle.map?.printings?.[printingKey];
  if (!mapping) return null;
  const row = bundle.prices?.byCardosId?.[mapping.cardosId];
  if (!row) return null;

  const printing = hydrate(row);
  const wanted = grade ? parseGradeLabel(grade) : null;
  const rung = wanted ? printing.graded.find((r) => r.label === wanted.label) ?? null : null;

  const fetchedMs = Date.parse(printing.fetchedAt);
  return {
    printing,
    // A requested grade that has no rung yields null — NOT the raw price. Those
    // are different cards commercially: a PSA 10 and a loose copy of the same
    // printing routinely differ by an order of magnitude, so substituting one for
    // the other would be the most expensive possible "helpful" fallback.
    comp: wanted ? rung?.comp ?? null : printing.raw,
    isRaw: !wanted,
    ageMs: Number.isFinite(fetchedMs) ? now - fetchedMs : Number.NaN,
  };
}
