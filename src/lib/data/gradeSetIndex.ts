import { unstable_cache } from "next/cache";
import { readSnapshot } from "../db/snapshots";
import { labelFor, type EntityLabel } from "@/lib/indices/entityLabels";
import { PREMIUM_PAIRS } from "./gradePremium";
import { readPriceIndexKeys, type IndexPoint } from "./indices";

/**
 * The grade / set / premium half of the price-index blob.
 *
 * ⚠️ ENUMERATION, NOT ENQUIRY. Every surface that offers a grade or a set — the
 * rail flyouts, the command palette, the studio's picker, the tables' index
 * columns — asks THIS module what exists, and it answers from the blob's own
 * keys (`readPriceIndexKeys`). Nothing types a grade list. A grade that stops
 * clearing the identity floor stops being offered, in every one of those places,
 * on the next build.
 *
 * ⚠️ A HELD ENTITY IS ABSENT, NOT EMPTY. `readIndexSeries` already returns [] for
 * an entity the builder auto-held (selection premium past the hard limit), so the
 * <2-point cull below removes it from the catalogue too — a held set must not
 * appear in a picker offering a line that will never draw.
 */

type PriceIndexBlob = {
  generatedAt?: string;
  cadence?: "monthly" | "weekly";
  series?: Record<string, IndexPoint[]>;
  biasTests?: {
    entities?: Record<
      string,
      { selectionPremiumPP: number | null; heldReason?: "selection-premium" | null }
    >;
  };
};

export type PublishedEntity = EntityLabel & {
  points: number;
  /** Latest published level, and the month it is stamped at. */
  level: number | null;
  latestTs: string | null;
  /** Month-over-month change between the last two published months, percent.
   *  ⚠️ null when the two months are not adjacent — see `monthGap`. */
  changePct1m: number | null;
  /** Months spanned by that change. >1 means a month was withheld between them,
   *  and the move must not be read as one month's. */
  monthGap: number;
  selectionPremiumPP: number | null;
};

const EMPTY: PriceIndexBlob = {};

async function blob(): Promise<PriceIndexBlob> {
  return (await readSnapshot<PriceIndexBlob>("price-index")) ?? EMPTY;
}

/** Calendar months between two month-end stamps. */
function monthsBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso), b = new Date(bIso);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

function summarise(id: string, pts: IndexPoint[]): PublishedEntity {
  const clean = pts.filter((p) => Number.isFinite(p.value) && p.value > 0);
  const last = clean.at(-1) ?? null;
  const prev = clean.at(-2) ?? null;
  const gap = last && prev ? monthsBetween(prev.ts, last.ts) : 0;
  return {
    ...labelFor(id),
    points: clean.length,
    level: last?.value ?? null,
    latestTs: last?.ts ?? null,
    // ⚠️ A GAP IS NOT A MONTH. When the month between two published points was
    // withheld for thinness, the move covers more than a month and is not a "1m
    // change" — so it is withheld here rather than mislabelled.
    changePct1m: last && prev && gap === 1 && prev.value > 0 ? (last.value / prev.value - 1) * 100 : null,
    monthGap: gap,
    selectionPremiumPP: null,
  };
}

/**
 * Every published entity under a prefix, thin ones culled, biggest level first.
 * `prefix` is the blob's own entity word: "grade", "set", "premium".
 */
async function listPublished(prefix: string): Promise<PublishedEntity[]> {
  const b = await blob();
  if (b.cadence !== "monthly") return []; // same guard readIndexSeries applies
  const series = b.series ?? {};
  const meta = b.biasTests?.entities ?? {};
  const out: PublishedEntity[] = [];
  for (const id of await readPriceIndexKeys()) {
    if (!id.startsWith(`${prefix}:`)) continue;
    if (meta[id]?.heldReason) continue; // auto-held → absent everywhere
    const pts = series[id] ?? [];
    if (pts.length < 2) continue; // a line needs two points to be a line
    const e = summarise(id, pts);
    if (e.points < 2) continue;
    e.selectionPremiumPP = meta[id]?.selectionPremiumPP ?? null;
    out.push(e);
  }
  return out.sort((a, b2) => (b2.level ?? 0) - (a.level ?? 0));
}

export const listGradeIndices = unstable_cache(
  () => listPublished("grade"),
  ["grade-indices:v1"],
  { revalidate: 1800, tags: ["platform-buckets"] },
);

export const listSetIndices = unstable_cache(
  () => listPublished("set"),
  ["set-indices:v1"],
  { revalidate: 1800, tags: ["platform-buckets"] },
);

/** Set entities for ONE ip, keyed by set_key — what a set page asks for. */
export async function setIndicesFor(ip: string): Promise<Map<string, PublishedEntity>> {
  const all = await listSetIndices();
  const out = new Map<string, PublishedEntity>();
  for (const e of all) {
    if (!e.key.startsWith(`${ip}:`)) continue;
    out.set(e.key.slice(ip.length + 1), e);
  }
  return out;
}

export type PremiumSeries = {
  pair: (typeof PREMIUM_PAIRS)[number];
  points: IndexPoint[];
  /** Why there is no line, when there is none. */
  absent: "not-published" | null;
};

/**
 * Every pair the site publishes, in the order the switches appear — INCLUDING
 * the ones with no series.
 *
 * ⚠️ AN ABSENT PAIR STILL GETS A SWITCH. A pair can compute to nothing (raw
 * sales rarely carry a comparable identity), and silently hiding the switch would
 * leave a reader wondering whether we had never thought of it. The switch is
 * present, disabled, and says why.
 *
 * ⚠️ THE BLOB PUBLISHES A RATIO (3.55), THE CHART READS A PERCENT (355%). Both
 * say the same thing — a 3.55× premium IS 355% of the lower grade — and the
 * conversion happens HERE, once, at the boundary, rather than in each surface.
 * The chart's own rule is "100% is drawn and it is the reading", and moving that
 * baseline to 1.0 would change a published surface for no gain; multiplying at
 * the reader keeps the picture identical to the one already reviewed while the
 * number stays the backend's.
 */
export const PREMIUM_TO_PERCENT = 100;

export const readPremiumSeries = unstable_cache(
  async (): Promise<PremiumSeries[]> => {
    const b = await blob();
    const series = b.cadence === "monthly" ? b.series ?? {} : {};
    return PREMIUM_PAIRS.map((pair) => {
      const pts = (series[pair.id] ?? [])
        .filter((p) => Number.isFinite(p.value) && p.value > 0)
        .map((p) => ({
          ts: p.ts,
          value: p.value * PREMIUM_TO_PERCENT,
          n: p.n,
          // The backend's band is the INTERQUARTILE SPREAD of the matched ratios
          // themselves, so it scales with the value and travels with it.
          lo: p.lo != null ? p.lo * PREMIUM_TO_PERCENT : undefined,
          hi: p.hi != null ? p.hi * PREMIUM_TO_PERCENT : undefined,
        }));
      return { pair, points: pts, absent: pts.length >= 2 ? null : ("not-published" as const) };
    });
  },
  ["grade-premiums:v2"],
  { revalidate: 1800, tags: ["platform-buckets"] },
);
