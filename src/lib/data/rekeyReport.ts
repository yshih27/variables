/**
 * THE v4.2 RE-KEY REPORT — what changing the identity key did, measured.
 *
 * ⚠️ WHY A WHOLE MODULE. Re-keying the identity moves every published level: a
 * card that was two thin keys becomes one key with twice the sales, so it clears
 * MIN_SALES_PER_IDENTITY where it did not, enters the overlap where it did not,
 * and the weighted median lands somewhere else. That is the WHOLE POINT, and it
 * is also indistinguishable from a bug unless the before and after are put side
 * by side. Nothing here writes: the shadow build runs the same builder twice over
 * the same panel — once with the v4.1 keys the rows carry in `legacyIdentity`,
 * once with the v4.2 keys in `identity` — and these functions difference the two.
 *
 * ⚠️ AND WHY THE MERGE REVIEW. A merge that should not have happened is the one
 * failure mode a level-by-level diff cannot show: two genuinely different cards
 * folded onto one key print a plausible number built from two products. So the
 * report lists the largest merges with the RAW strings that were folded, and the
 * signals that would distinguish an honest fold (a set string written two ways) 
 * from a false one (two print runs whose denominators differ), for a human to
 * judge — the judgment goes in the PR body, not in this file.
 */
import type { IndexPoint } from "./indices";
import type { SaleRow } from "./salePanel";
import { parseIdentityKey } from "./traits";
import { normalizeCardNumber } from "@/lib/card/cardNumber";
import { normalizeSetName } from "@/lib/card/setName";
import { identitySlug, legacyIdentitySlug } from "@/lib/card/identity";

// ── keys and fragments ───────────────────────────────────────────────────────

export type KeyCounts = {
  /** Distinct identity keys on the panel's sales. */
  panelKeys: number;
  /** Distinct identity keys over every card in `cards` (the dims scan). */
  cardKeys: number;
  /** Slugs that resolve to more than one key. */
  fragmentedSlugs: number;
  /** Σ (keys − 1) over those slugs — the "same card keyed twice" count. */
  fragmentKeys: number;
};

/** slug → keys, as the slug index holds it. */
export type SlugKeys = Map<string, string[]>;

export type FragmentCount = { fragmentedSlugs: number; fragmentKeys: number; worst: { slug: string; keys: string[] }[] };

/**
 * Keys that share ONE canonical URL — the measured definition of "the same card
 * keyed twice".
 *
 * ⚠️ COUNTED FROM THE KEYS, NOT FROM THE SLUG INDEX. The index deliberately
 * holds v4.1 aliases so old URLs keep resolving, and an alias is a second slug
 * pointing at a key that already has its own — counting the index's entries
 * would score this project's own redirects as fragmentation and flatter the
 * before/after by exactly the number of aliases.
 */
export function fragmentsOfKeys(keys: Iterable<string>, slugOf: (key: string) => string | null): FragmentCount {
  const bySlug = new Map<string, Set<string>>();
  for (const k of keys) {
    const slug = slugOf(k);
    if (!slug) continue;
    const set = bySlug.get(slug);
    if (set) set.add(k);
    else bySlug.set(slug, new Set([k]));
  }
  let fragmentedSlugs = 0;
  let fragmentKeys = 0;
  const worst: { slug: string; keys: string[] }[] = [];
  for (const [slug, set] of bySlug) {
    if (set.size < 2) continue;
    fragmentedSlugs += 1;
    fragmentKeys += set.size - 1;
    worst.push({ slug, keys: [...set] });
  }
  worst.sort((a, b) => b.keys.length - a.keys.length);
  return { fragmentedSlugs, fragmentKeys, worst: worst.slice(0, 25) };
}

/** Every identity key a slug index knows, alias entries folded away. */
export function keysOf(idx: { bySlug: SlugKeys; slabsByKey: Map<string, unknown> }): Set<string> {
  const out = new Set<string>();
  for (const keys of idx.bySlug.values()) for (const k of keys) out.add(k);
  for (const k of idx.slabsByKey.keys()) out.add(k);
  return out;
}

// ── what each rule does on its own ───────────────────────────────────────────

/**
 * The re-key is two rules at once (canonical set, normalised number) plus the
 * language the set string carries. This re-keys the panel under each rule ALONE
 * so the report can say which one did the merging, rather than attributing the
 * whole fold to "v4.2".
 */
export type RuleSplit = {
  /** Distinct keys under: v4.1, the number rule only, the set rule only, v4.2. */
  keys: { before: number; numberOnly: number; setOnly: number; after: number };
  /** Identities each rule removes on its own (before − rule). */
  merged: { number: number; set: number; both: number };
  /** Raw number tokens the number rule rewrites, and the distinct ones. */
  numbersChanged: { rows: number; distinct: number };
};

function reKeyed(legacyKey: string, opts: { number: boolean; set: boolean }): string | null {
  const f = legacyKey.split("|");
  if (f.length !== 7) return null;
  const [ip, set, number, name, grade, edition, language] = f;
  const setId = set ? normalizeSetName(set) : null;
  const nextSet = opts.set ? (setId ? setId.key ?? setId.slug : "") : set;
  const nextNum = opts.number ? normalizeCardNumber(number) ?? "" : number;
  const nextLang = opts.set && !language && setId?.language ? { ja: "Japanese", ko: "Korean", zh: "Chinese" }[setId.language] ?? "" : language;
  return [ip, nextSet, nextNum, name, grade, edition, nextLang].join("|");
}

export function ruleSplit(panel: SaleRow[]): RuleSplit {
  const before = new Set<string>();
  const numberOnly = new Set<string>();
  const setOnly = new Set<string>();
  const after = new Set<string>();
  const changedNumbers = new Set<string>();
  let changedRows = 0;
  for (const r of panel) {
    const legacy = r.legacyIdentity;
    if (!legacy) continue;
    before.add(legacy);
    if (r.identity) after.add(r.identity);
    const n = reKeyed(legacy, { number: true, set: false });
    const s = reKeyed(legacy, { number: false, set: true });
    if (n) numberOnly.add(n);
    if (s) setOnly.add(s);
    const rawNum = legacy.split("|")[2];
    if (rawNum && normalizeCardNumber(rawNum) !== rawNum) {
      changedRows += 1;
      changedNumbers.add(rawNum);
    }
  }
  return {
    keys: { before: before.size, numberOnly: numberOnly.size, setOnly: setOnly.size, after: after.size },
    merged: {
      number: before.size - numberOnly.size,
      set: before.size - setOnly.size,
      both: before.size - after.size,
    },
    numbersChanged: { rows: changedRows, distinct: changedNumbers.size },
  };
}

// ── the merge review ─────────────────────────────────────────────────────────

export type MergeRecord = {
  /** The v4.2 key the old keys folded onto. */
  key: string;
  slug: string | null;
  /** Panel sales on the merged identity. */
  sales: number;
  /** The v4.1 keys that folded in, largest first. */
  from: { key: string; sales: number; rawSet: string; rawNumber: string; canonicalSet: string; canonicalNumber: string }[];
  /** Distinct raw set strings / raw numbers / `/total` denominators folded. */
  distinct: { sets: number; numbers: number; denominators: string[] };
  /**
   * What the reviewer has to look at. `set-variant` = one set written several
   * ways. `number-variant` = one number written several ways. `denominator-split`
   * = the folded numbers carried DIFFERENT set totals, which is the one signal
   * that two different print runs may have been folded — read those by hand.
   */
  signals: ("set-variant" | "number-variant" | "language-variant" | "denominator-split")[];
};

export function mergeReview(panel: SaleRow[], limit = 30): { merges: MergeRecord[]; total: number; suspect: number } {
  const salesByLegacy = new Map<string, number>();
  const legacyByNew = new Map<string, Set<string>>();
  const salesByNew = new Map<string, number>();
  for (const r of panel) {
    if (!r.identity || !r.legacyIdentity) continue;
    salesByLegacy.set(r.legacyIdentity, (salesByLegacy.get(r.legacyIdentity) ?? 0) + 1);
    salesByNew.set(r.identity, (salesByNew.get(r.identity) ?? 0) + 1);
    let set = legacyByNew.get(r.identity);
    if (!set) legacyByNew.set(r.identity, (set = new Set()));
    set.add(r.legacyIdentity);
  }
  const merges: MergeRecord[] = [];
  for (const [key, olds] of legacyByNew) {
    if (olds.size < 2) continue;
    const from = [...olds]
      .map((k) => {
        const f = k.split("|");
        return {
          key: k,
          sales: salesByLegacy.get(k) ?? 0,
          rawSet: f[1] ?? "",
          rawNumber: f[2] ?? "",
          canonicalSet: f[1] ? normalizeSetName(f[1]).key ?? normalizeSetName(f[1]).slug : "",
          canonicalNumber: normalizeCardNumber(f[2] ?? "") ?? "",
        };
      })
      .sort((a, b) => b.sales - a.sales);
    const sets = new Set(from.map((f) => f.rawSet));
    const numbers = new Set(from.map((f) => f.rawNumber));
    const langs = new Set(from.map((f) => f.key.split("|")[6] ?? ""));
    const denominators = [...new Set(from.map((f) => (f.rawNumber.includes("/") ? f.rawNumber.split("/")[1] : "")).filter(Boolean))];
    const signals: MergeRecord["signals"] = [];
    if (sets.size > 1) signals.push("set-variant");
    if (numbers.size > 1) signals.push("number-variant");
    if (langs.size > 1) signals.push("language-variant");
    if (denominators.length > 1) signals.push("denominator-split");
    merges.push({
      key,
      slug: slugOfKey(key),
      sales: salesByNew.get(key) ?? 0,
      from,
      distinct: { sets: sets.size, numbers: numbers.size, denominators },
      signals,
    });
  }
  merges.sort((a, b) => b.sales - a.sales || b.from.length - a.from.length);
  return {
    merges: merges.slice(0, limit),
    total: merges.length,
    suspect: merges.filter((m) => m.signals.includes("denominator-split")).length,
  };
}

/**
 * The identity slug for a key — the blob's receipts and this report both need
 * "which card is this key?", and neither may build a slug of its own.
 * Memoised: a step's sample repeats the same keys month after month.
 */
export function slugOfKey(key: string): string | null {
  const hit = slugMemo.get(key);
  if (hit !== undefined) return hit;
  const pk = parseIdentityKey(key);
  const slug = pk ? identitySlug(pk.ip, pk.parts) : null;
  slugMemo.set(key, slug);
  return slug;
}
const slugMemo = new Map<string, string | null>();

/** The same, for a v4.1 key — the "before" side of the fragment count. */
export function legacySlugOfKey(key: string): string | null {
  const pk = parseIdentityKey(key);
  return pk ? legacyIdentitySlug(pk.ip, pk.parts) : null;
}

// ── the level-by-level diff ──────────────────────────────────────────────────

export type MonthDiff = {
  month: string; // month-END ISO
  levelBefore: number | null;
  levelAfter: number | null;
  /** levelAfter − levelBefore, index points. Null unless both published. */
  levelDeltaPts: number | null;
  stepBefore: number | null; // %
  stepAfter: number | null; // %
  /** stepAfter − stepBefore, percentage points. */
  stepDeltaPP: number | null;
  identitiesBefore: number | null;
  identitiesAfter: number | null;
  thinBefore: boolean;
  thinAfter: boolean;
};

export type EntityDiff = {
  id: string;
  sales: number;
  baseBefore: string | null;
  baseAfter: string | null;
  months: MonthDiff[];
  /** Months published under v4.2 and not v4.1, and the reverse. */
  onlyAfter: string[];
  onlyBefore: string[];
};

function stepsOf(points: IndexPoint[]): Map<string, { level: number; step: number | null; n: number | null; thin: boolean }> {
  const out = new Map<string, { level: number; step: number | null; n: number | null; thin: boolean }>();
  points.forEach((p, i) => {
    const prev = i > 0 ? points[i - 1] : null;
    out.set(p.ts, {
      level: p.value,
      step: prev && prev.value > 0 ? (p.value / prev.value - 1) * 100 : null,
      n: p.n ?? null,
      thin: p.thin === true,
    });
  });
  return out;
}

export function diffEntity(id: string, before: IndexPoint[], after: IndexPoint[], sales: number): EntityDiff {
  const b = stepsOf(before);
  const a = stepsOf(after);
  const months = [...new Set([...b.keys(), ...a.keys()])].sort();
  return {
    id,
    sales,
    baseBefore: before[0]?.ts ?? null,
    baseAfter: after[0]?.ts ?? null,
    months: months.map((m) => {
      const x = b.get(m) ?? null;
      const y = a.get(m) ?? null;
      return {
        month: m,
        levelBefore: x?.level ?? null,
        levelAfter: y?.level ?? null,
        levelDeltaPts: x && y ? y.level - x.level : null,
        stepBefore: x?.step ?? null,
        stepAfter: y?.step ?? null,
        stepDeltaPP: x?.step != null && y?.step != null ? y.step - x.step : null,
        identitiesBefore: x?.n ?? null,
        identitiesAfter: y?.n ?? null,
        thinBefore: x?.thin ?? false,
        thinAfter: y?.thin ?? false,
      };
    }),
    onlyAfter: months.filter((m) => a.has(m) && !b.has(m)),
    onlyBefore: months.filter((m) => b.has(m) && !a.has(m)),
  };
}

// ── the Markdown the PR body carries ─────────────────────────────────────────

const fmtL = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const fmtP = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const fmtD = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}`);

/** The shadow table: `topEntities` × the last `months` published months. */
export function shadowTable(diffs: EntityDiff[], opts: { entities?: number; months?: number } = {}): string {
  const top = diffs.slice(0, opts.entities ?? 12);
  const nMonths = opts.months ?? 6;
  const lines: string[] = [];
  lines.push("| entity | month | identities (old → new) | step (old → new) | Δpp | level (old → new) | Δpts | thin |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const d of top) {
    const months = d.months.slice(-nMonths);
    months.forEach((m, i) => {
      const thin = `${m.thinBefore ? "thin" : "—"} → ${m.thinAfter ? "thin" : "—"}`;
      lines.push(
        `| ${i === 0 ? `\`${d.id}\`` : ""} | ${m.month.slice(0, 7)} | ${m.identitiesBefore ?? "—"} → ${m.identitiesAfter ?? "—"} | ` +
          `${fmtP(m.stepBefore)} → ${fmtP(m.stepAfter)} | ${fmtD(m.stepDeltaPP)} | ${fmtL(m.levelBefore)} → ${fmtL(m.levelAfter)} | ${fmtD(m.levelDeltaPts)} | ${thin} |`,
      );
    });
  }
  return lines.join("\n");
}

/** The merge review table — raw strings, so a false merge is visible. */
export function mergeTable(merges: MergeRecord[]): string {
  const lines: string[] = [];
  lines.push("| sales | merged identity | folded from (raw set · raw number · sales) | signals |");
  lines.push("| --- | --- | --- | --- |");
  for (const m of merges) {
    const parts = m.key.split("|");
    const label = `${parts[3]} · ${parts[4]} · set \`${parts[1]}\` · #${parts[2]}${parts[6] ? ` · ${parts[6]}` : ""}`;
    const from = m.from.map((f) => `\`${f.rawSet || "—"}\` · \`#${f.rawNumber || "—"}\` · ${f.sales}`).join("<br>");
    lines.push(`| ${m.sales} | ${label} | ${from} | ${m.signals.join(", ") || "—"} |`);
  }
  return lines.join("\n");
}
