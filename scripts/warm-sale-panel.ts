/**
 * Price-index warmer — builds the sale-price panel, computes the MONTHLY identity-
 * comparables index (v4) per IP, builds category + market indices over POOLED
 * identities, measures the selection premium, and stores it all in the
 * `price-index` snapshot blob. The same run persists the panel, the identity
 * index (+ slabs) and the character rollups, so no reader builds any of them.
 *
 *   npx tsx --env-file=.env.local scripts/warm-sale-panel.ts
 *   npx tsx --env-file=.env.local scripts/warm-sale-panel.ts --out=/tmp/blob   # LOCAL: write
 *       <out>/price-index.json instead of Postgres, for gating / rendering a
 *       rebuilt blob without touching production (readSnapshot honours
 *       SNAPSHOT_LOCAL_DIR=<out>).
 *   npx tsx --env-file=.env.local scripts/warm-sale-panel.ts --out=/tmp/blob --shadow-rekey
 *       THE v4.2 SHADOW BUILD. Requires --out. Builds the panel ONCE carrying both
 *       identity keys, then runs the whole index twice — under the v4.1 keys and
 *       under the v4.2 keys — and writes, beside the new blob: the old-keyed blob
 *       (price-index.v4.1.json), rekey-report.json + rekey-report.md (the level-by-
 *       level diff, the merge review and the fragment counts the PR body carries)
 *       and the method-changes snapshot the methodology page renders from.
 *
 * WHAT IS IN THE BLOB, AND WHY EVERY SURFACE READS IT RATHER THAN TYPING ANYTHING:
 *   series[entity]           month-END-stamped IndexPoints, n = identities in the
 *                            step, lo/hi = bootstrap band, spansWeeks on gaps.
 *   cadence                  "monthly".
 *   method                   "v4.2" — the identity keying the levels were built
 *                            under. A reader that does not know a method must not
 *                            serve its numbers under this one's copy.
 *   stepObs[entity][ts]      the step's sample, one tuple per identity:
 *                            [slug, logReturn, weight, priceFrom, priceTo, nFrom, nTo].
 *                            INV-13 re-derives the estimator from it and
 *                            readIndexReceipts prints it.
 *   holds[entity]            the months that did NOT publish, each with the gate
 *                            that held it — so a gap explains itself from data.
 *   biasTests.invariance     the holding-period test for V-MKT (INV-12).
 *   biasTests.entities[e]    selectionPremiumPP (the disclosed resale skew), the
 *                            market-cap anchor over the series' span, and
 *                            heldReason="selection-premium" when the skew is past
 *                            the hard limit — readIndexSeries then withholds it.
 *
 * ENTITY KINDS in `series`: `market:total`, `category:<c>`, `ip:<ip>`,
 * `grade:<slug>` (every grade clearing the narrow floor) and `set:<ip>:<key>`
 * (every set clearing it, keyed by the set-name SSOT). All five are the SAME
 * estimator with the same floors, bias tests and automatic hold — a grade index
 * is not a special case, it is the identity index over a grade's sales.
 *
 * `premium:<a>:<b>` series are NOT indices: they are within-identity RATIOS (see
 * gradePremium.ts) and carry no biasTests entry, because a ratio of the same
 * card to itself has no holding period to be invariant over.
 *
 * The v2 token repeat-sales and weekly identity builders stay exported from their
 * modules for comparison only; nothing here calls them.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { buildSalePanel, writeSalePanel, packSalePanel, SALE_PANEL_SNAPSHOT_KEY, type SaleRow } from "../src/lib/data/salePanel";
import { chainIdentityIndex, MIN_IDENTITIES_BROAD, MIN_IDENTITIES_IP, type IndexHold, type StepObs } from "../src/lib/data/identityIndex";
import type { IndexPoint } from "../src/lib/data/indices";
import type { StepObsTuple } from "../src/lib/data/indexReceipts";
import { slugOfKey, legacySlugOfKey, ruleSplit, fragmentsOfKeys, keysOf, mergeReview, diffEntity, shadowTable, mergeTable, type EntityDiff } from "../src/lib/data/rekeyReport";
import { ipsInCategory, type IPCategory } from "../src/lib/data/ipCatalog";
import { readSnapshot, writeSnapshot } from "../src/lib/db/snapshots";
import { holdingPeriodInvariance, INDEX_HARD_SKEW_PP } from "../src/lib/data/biasTests";
import { buildIdentityIndex, packIdentityIndex, writeIdentityIndex, cachedListingIndex, IDENTITY_INDEX_SNAPSHOT_KEY, IDENTITY_SLABS_SNAPSHOT_KEY } from "../src/lib/data/identityDetail";
import { buildCharacterRollups, packCharacterRollups, resolveCharacterArt, writeCharacterRollups, CHARACTER_ROLLUPS_SNAPSHOT_KEY } from "../src/lib/data/characterRollups";
import { canonicalGrade, gradePremiumSeries, PREMIUM_PAIRS } from "../src/lib/data/gradePremium";
import { readMetricSeries } from "../src/lib/data/metricSnapshots";
import { runWarmer } from "../src/lib/db/runWarmer";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const OUT_DIR = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? null;
/**
 * ⚠️ THE SHADOW BUILD IS `--out`-ONLY, ENFORCED. Its whole purpose is to show
 * what the re-key WOULD do before anything is cut over; a shadow run that wrote
 * production would have performed the cutover it was meant to preview.
 */
const SHADOW = process.argv.includes("--shadow-rekey");
/** The identity keying these levels were built under — carried in the blob. */
const METHOD = "v4.2" as const;
const PREVIOUS_METHOD = "v4.1" as const;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type EntityMeta = {
  selectionPremiumPP: number | null;
  heldReason: "selection-premium" | null;
  anchorPct: number | null;
  anchorSince: string | null;
};

/**
 * The market-cap anchor: tracked cap change over the SAME span as the series,
 * from the spine. Market/category sum their members' IP series. Null when either
 * end is missing — the receipt then simply omits the clause.
 */
async function capAnchor(entity: string, key: string, series: IndexPoint[]): Promise<{ pct: number | null; since: string | null }> {
  if (series.length < 2) return { pct: null, since: null };
  // ⚠️ ONLY where the spine actually holds the matching cap. There is no
  // per-GRADE market cap and no per-SET market cap, so anchoring those against
  // the whole market's cap would print a number that is not their anchor — the
  // receipt drops the clause instead (indexReceipt omits a null).
  if (entity === "grade" || entity === "set") return { pct: null, since: null };
  const ips =
    entity === "ip" ? [key] : entity === "category" ? ipsInCategory(key as IPCategory) : ipsInCategory("tcg").concat(ipsInCategory("sports"));
  const perDay = new Map<string, number>();
  for (const ip of ips) {
    for (const p of await readMetricSeries("ip", ip, "mcap_usd")) {
      if (!(p.value > 0)) continue;
      const d = p.ts.slice(0, 10);
      perDay.set(d, (perDay.get(d) ?? 0) + p.value);
    }
  }
  const days = [...perDay.keys()].sort();
  if (!days.length) return { pct: null, since: null };
  const startMs = Date.parse(series[0].ts), endMs = Date.parse(series[series.length - 1].ts);
  // First cap reading on/after the base month-end, last on/before the latest one.
  const a = days.find((d) => Date.parse(d) >= startMs) ?? days[0];
  const b = [...days].reverse().find((d) => Date.parse(d) <= endMs) ?? days[days.length - 1];
  const va = perDay.get(a)!, vb = perDay.get(b)!;
  return { pct: va > 0 ? (vb / va - 1) * 100 : null, since: MON[new Date(a).getUTCMonth()] };
}

/**
 * THE METHOD LEDGER — append-only, one record per published method.
 *
 * ⚠️ SO THE METHODOLOGY PAGE RENDERS THE BEFORE/AFTER FROM DATA. A method change
 * that lives in typed copy rots the day the next one ships: the page keeps
 * claiming a move nobody can check against the series it sits beside. This
 * carries the measured levels, and only a SHADOW build can produce them (it is
 * the only run that holds both keyings), so the real warmer publishes the file
 * the shadow build wrote rather than inventing a record of its own.
 */
export type MethodChange = {
  version: string;
  date: string;
  summary: string;
  entities: { id: string; month: string; levelBefore: number | null; levelAfter: number | null; identitiesBefore: number | null; identitiesAfter: number | null }[];
};
const METHOD_CHANGES_SNAPSHOT_KEY = "method-changes";
const METHOD_CHANGES_FILE = process.argv.find((a) => a.startsWith("--method-changes="))?.split("=")[1] ?? null;

/** Existing records + anything in `incoming` whose version is not already there. */
function appendMethodChanges(existing: MethodChange[], incoming: MethodChange[]): MethodChange[] {
  const have = new Set(existing.map((c) => c.version));
  return [...existing, ...incoming.filter((c) => !have.has(c.version))];
}

type SeriesSet = {
  series: Record<string, IndexPoint[]>;
  salesOf: Record<string, SaleRow[]>;
  /** entity → the months it withheld, with the gate that withheld each. */
  holds: Record<string, IndexHold[]>;
  gated: string[];
  mktSales: SaleRow[];
};

/**
 * Every published entity's chain, from ONE panel.
 *
 * ⚠️ EXTRACTED SO THE SHADOW BUILD CANNOT DIVERGE FROM THE REAL ONE. The v4.2
 * re-key is measured by running this over the same panel twice — once with the
 * rows' v4.1 keys swapped in — and a "before" built by a second, similar-looking
 * function would be measuring the function, not the re-key.
 */
function buildSeriesSet(panel: SaleRow[]): SeriesSet {
  const series: Record<string, IndexPoint[]> = {};
  const salesOf: Record<string, SaleRow[]> = {};
  const holds: Record<string, IndexHold[]> = {};
  const gated: string[] = [];
  const chain = (id: string, sales: SaleRow[], minIdentities: number, listWhenGated: boolean, label = id) => {
    const { points, holds: held } = chainIdentityIndex(sales, { minIdentities, grain: "month" });
    if (!points.length) {
      if (listWhenGated) gated.push(`${label}(${sales.length})`); // too few priced identities — publish nothing
      return;
    }
    series[id] = points;
    salesOf[id] = sales;
    if (held.length) holds[id] = held;
  };

  // Group sales by IP (skip "other" — no publishable single-IP index).
  const byIp = new Map<string, SaleRow[]>();
  for (const r of panel) {
    if (r.ip === "other") continue;
    const a = byIp.get(r.ip);
    if (a) a.push(r);
    else byIp.set(r.ip, [r]);
  }
  for (const [ip, sales] of byIp) chain(`ip:${ip}`, sales, MIN_IDENTITIES_IP, true, ip);

  // Categories + market: POOLED identities, same estimator, broader floor.
  for (const cat of ["tcg", "sports", "other"] as IPCategory[]) {
    const members = new Set(ipsInCategory(cat));
    chain(`category:${cat}`, panel.filter((r) => members.has(r.ip)), MIN_IDENTITIES_BROAD, false);
  }

  // ── Grades. One entity per canonical grade label; the narrow floor, because a
  //    grade is a slice of the market, not the market. "PSA 10.0" folds into
  //    "PSA 10" and BECKETT into BGS via the grade SSOT before grouping, or the
  //    same grade would publish twice at two different levels.
  const byGrade = new Map<string, SaleRow[]>();
  for (const r of panel) {
    if (r.ip === "other") continue;
    const g = canonicalGrade(r.grade);
    const a = byGrade.get(g);
    if (a) a.push(r);
    else byGrade.set(g, [r]);
  }
  const gradeSlug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  for (const [label, sales] of byGrade) chain(`grade:${gradeSlug(label)}`, sales, MIN_IDENTITIES_IP, true, `grade:${label}`);

  // ── Sets. Keyed by the set-name SSOT, scoped by IP so two IPs cannot share a
  //    key. A set that does not clear the floor publishes nothing — the set page
  //    still has volume and sales, and says the index is absent. Thin sets are
  //    the rule here, so they are not listed as gated.
  const bySet = new Map<string, SaleRow[]>();
  for (const r of panel) {
    if (r.ip === "other" || !r.setKey) continue;
    const id = `set:${r.ip}:${r.setKey}`;
    const a = bySet.get(id);
    if (a) a.push(r);
    else bySet.set(id, [r]);
  }
  for (const [id, sales] of bySet) chain(id, sales, MIN_IDENTITIES_IP, false);

  const mktSales = panel.filter((r) => r.ip !== "other");
  chain("market:total", mktSales, MIN_IDENTITIES_BROAD, false);

  return { series, salesOf, holds, gated, mktSales };
}

/**
 * THE SHADOW BUILD — the same panel, indexed twice, differenced.
 *
 * Writes, all under `--out` and nothing else:
 *   price-index.v4.1.json   the OLD-keyed blob, so the two can be diffed by hand
 *                           or rendered side by side with SNAPSHOT_LOCAL_DIR
 *   rekey-report.json       every number in this comment, machine-readable
 *   rekey-report.md         the tables the PR body carries
 *   method-changes.json     the ledger record the real warmer publishes at cutover
 *
 * ⚠️ THE CHARACTER AND PREMIUM COUNTS ARE HERE FOR A REASON. Both are built on
 * identity keys — the premium joins a card to ITSELF across grades, the rollups
 * group identities by character — so a re-key moves them even though neither is
 * an index. A premium pair that gains months, or a character that gains
 * identities, is the re-key working; one that LOSES them is the alarm.
 */
async function writeShadowRekey(ctx: {
  dir: string;
  now: string;
  panel: SaleRow[];
  after: Record<string, IndexPoint[]>;
  afterSalesOf: Record<string, SaleRow[]>;
  holds: Record<string, IndexHold[]>;
  identityIdx: Awaited<ReturnType<typeof buildIdentityIndex>>;
  charactersAfter: { characters: number; indexed: number; coverage: Record<string, { identities: number; mapped: number; multiCharacter: number }> };
  premiumsAfter: Record<string, IndexPoint[]>;
}): Promise<void> {
  const t0 = Date.now();
  console.log(`\n── shadow re-key (${PREVIOUS_METHOD} → ${METHOD}) ─────────────────────────────`);

  // The SAME panel under the old keys. Nothing else about the build changes.
  const legacyPanel: SaleRow[] = ctx.panel.map((r) => ({ ...r, identity: r.legacyIdentity ?? null }));
  const before = buildSeriesSet(legacyPanel);
  const beforePremiums: Record<string, IndexPoint[]> = {};
  for (const pair of PREMIUM_PAIRS) {
    const s1 = gradePremiumSeries(before.mktSales, pair.better, pair.worse, { minSales: 1 });
    if (s1.length) beforePremiums[pair.id] = s1;
  }

  // Fragments: several keys sharing ONE canonical URL, under each keying. The
  // dims scan behind both builds is memoised, so the second is CPU only.
  const legacyIdx = await buildIdentityIndex(legacyPanel, { keying: "v4.1" });
  const fragBefore = fragmentsOfKeys(keysOf(legacyIdx), legacySlugOfKey);
  const fragAfter = fragmentsOfKeys(keysOf(ctx.identityIdx), slugOfKey);
  // How many v4.1 URLs the index keeps alive that the proxy's 301 cannot derive
  // (a set the normaliser judged junk slugged as `-` and now slugs as its own
  // bucket). Reported, because it is the size of the compatibility surface.
  const aliasSlugs = ctx.identityIdx.bySlug.size - new Set([...keysOf(ctx.identityIdx)].map(slugOfKey).filter(Boolean)).size;

  const charsBefore = buildCharacterRollups(legacyPanel, legacyIdx, { nowMs: Date.parse(ctx.now) });

  const rules = ruleSplit(ctx.panel);
  const { merges, total: mergeTotal, suspect } = mergeReview(ctx.panel, 30);

  const salesOfId = (id: string) => (ctx.afterSalesOf[id] ?? before.salesOf[id] ?? []).length;
  const ids = [...new Set([...Object.keys(before.series), ...Object.keys(ctx.after)])].filter((id) => !id.startsWith("premium:"));
  const diffs: EntityDiff[] = ids
    .map((id) => diffEntity(id, before.series[id] ?? [], ctx.after[id] ?? [], salesOfId(id)))
    .sort((a, b) => {
      // market first, then the entities with the most published months.
      if (a.id === "market:total") return -1;
      if (b.id === "market:total") return 1;
      return b.months.length - a.months.length || a.id.localeCompare(b.id);
    });

  const onlyAfter = diffs.flatMap((d) => d.onlyAfter.map((m) => `${d.id} ${m.slice(0, 7)}`));
  const onlyBefore = diffs.flatMap((d) => d.onlyBefore.map((m) => `${d.id} ${m.slice(0, 7)}`));
  const entitiesOnlyAfter = ids.filter((id) => ctx.after[id] && !before.series[id]);
  const entitiesOnlyBefore = ids.filter((id) => before.series[id] && !ctx.after[id]);

  const report = {
    generatedAt: ctx.now,
    method: METHOD,
    previous: PREVIOUS_METHOD,
    panelRows: ctx.panel.length,
    rules,
    fragments: {
      before: { slugs: fragBefore.fragmentedSlugs, extraKeys: fragBefore.fragmentKeys, worst: fragBefore.worst },
      after: { slugs: fragAfter.fragmentedSlugs, extraKeys: fragAfter.fragmentKeys, worst: fragAfter.worst },
      slugsBefore: legacyIdx.bySlug.size,
      slugsAfter: ctx.identityIdx.bySlug.size,
      legacyUrlAliases: aliasSlugs,
    },
    merges: { total: mergeTotal, denominatorSplit: suspect, largest: merges },
    entities: diffs,
    entitiesOnlyAfter,
    entitiesOnlyBefore,
    monthsOnlyAfter: onlyAfter,
    monthsOnlyBefore: onlyBefore,
    premiums: {
      before: Object.entries(beforePremiums).map(([id, pts]) => ({ id, months: pts.length, latest: pts.at(-1)?.value ?? null, n: pts.at(-1)?.n ?? null })),
      after: Object.entries(ctx.premiumsAfter).map(([id, pts]) => ({ id, months: pts.length, latest: pts.at(-1)?.value ?? null, n: pts.at(-1)?.n ?? null })),
    },
    characters: {
      before: { characters: Object.keys(charsBefore.characters).length, indexed: Object.values(charsBefore.characters).filter((c) => c.index).length, coverage: charsBefore.coverage },
      after: ctx.charactersAfter,
    },
    holds: Object.fromEntries(Object.entries(ctx.holds).map(([id, h]) => [id, h.map((x) => `${x.ts.slice(0, 7)} ${x.reason}${x.overlap ? ` (${x.overlap} identities)` : ""}`)])),
  };
  writeFileSync(join(ctx.dir, "rekey-report.json"), JSON.stringify(report, null, 2));

  const beforeBlob = { generatedAt: ctx.now, cadence: "monthly" as const, method: PREVIOUS_METHOD, series: before.series, holds: before.holds };
  writeFileSync(join(ctx.dir, `price-index.${PREVIOUS_METHOD}.json`), JSON.stringify(beforeBlob));

  const movedMonths = diffs
    .flatMap((d) => d.months)
    .filter((m) => m.levelBefore != null && m.levelAfter != null && Math.abs(m.levelAfter - m.levelBefore) >= 0.05);
  const maxMove = Math.max(0, ...movedMonths.map((m) => Math.abs((m.levelAfter as number) - (m.levelBefore as number))));
  const changes: MethodChange[] = [
    {
      version: METHOD,
      date: ctx.now,
      summary:
        `The card identity is keyed on the canonical set and the normalised card number, not the raw strings. ` +
        `${rules.merged.both.toLocaleString()} of ${rules.keys.before.toLocaleString()} traded identities were the same card keyed more than once and are now one ` +
        `(${rules.merged.number.toLocaleString()} by the number rule alone, ${rules.merged.set.toLocaleString()} by the set rule alone); ` +
        `${fragBefore.fragmentKeys.toLocaleString()} fragmented identity pages fall to ${fragAfter.fragmentKeys.toLocaleString()}. ` +
        // The outcome sentence is measured, never asserted: on this panel the
        // re-key moved levels by fractions of a point and unlocked no month.
        (onlyAfter.length || onlyBefore.length
          ? `${onlyAfter.length} month${onlyAfter.length === 1 ? "" : "s"} that were withheld now publish and ${onlyBefore.length} that published are now withheld.`
          : `No month gained or lost publication; ${movedMonths.length} published level${movedMonths.length === 1 ? "" : "s"} moved, by at most ${maxMove.toFixed(1)} points.`),
      entities: diffs.flatMap((d) =>
        d.months.map((m) => ({ id: d.id, month: m.month, levelBefore: m.levelBefore, levelAfter: m.levelAfter, identitiesBefore: m.identitiesBefore, identitiesAfter: m.identitiesAfter })),
      ),
    },
  ];
  writeFileSync(join(ctx.dir, "method-changes.json"), JSON.stringify({ generatedAt: ctx.now, changes }, null, 2));

  const md = [
    `## v4.1 → v4.2 shadow build`,
    ``,
    `Panel: ${ctx.panel.length.toLocaleString()} sales. Identities on the panel: ${rules.keys.before.toLocaleString()} → ${rules.keys.after.toLocaleString()} ` +
      `(−${rules.merged.both.toLocaleString()}; number rule alone −${rules.merged.number.toLocaleString()}, set rule alone −${rules.merged.set.toLocaleString()}). ` +
      `Raw number tokens the rule rewrites: ${rules.numbersChanged.distinct.toLocaleString()} distinct across ${rules.numbersChanged.rows.toLocaleString()} sales.`,
    ``,
    `Fragments (several keys, one canonical URL): ${fragBefore.fragmentKeys.toLocaleString()} extra keys over ${fragBefore.fragmentedSlugs.toLocaleString()} slugs → ` +
      `${fragAfter.fragmentKeys.toLocaleString()} over ${fragAfter.fragmentedSlugs.toLocaleString()}. ` +
      `Slug index: ${legacyIdx.bySlug.size.toLocaleString()} → ${ctx.identityIdx.bySlug.size.toLocaleString()} entries, of which ${aliasSlugs.toLocaleString()} are v4.1 URLs kept alive as aliases.`,
    ``,
    `Published index entities: ${ids.filter((id) => before.series[id]).length} → ${ids.filter((id) => ctx.after[id]).length} ` +
      `(premium ratios are counted separately below, and are not index entities)` +
      (entitiesOnlyAfter.length ? ` · new: ${entitiesOnlyAfter.join(", ")}` : "") +
      (entitiesOnlyBefore.length ? ` · LOST: ${entitiesOnlyBefore.join(", ")}` : ""),
    ``,
    `Months published under v4.2 and not v4.1: ${onlyAfter.length}${onlyAfter.length ? ` — ${onlyAfter.slice(0, 20).join(", ")}` : ""}`,
    ``,
    `Months published under v4.1 and not v4.2: ${onlyBefore.length}${onlyBefore.length ? ` — ${onlyBefore.slice(0, 20).join(", ")}` : ""}`,
    ``,
    shadowTable(diffs, { entities: 12, months: 6 }),
    ``,
    `### The 30 largest merges (${mergeTotal.toLocaleString()} in all; ${suspect} carry a denominator split)`,
    ``,
    mergeTable(merges),
    ``,
    `### What still fragments, and why`,
    ``,
    `The re-key does not touch the NAME, so two spellings of one card still key twice. These are the ${fragAfter.fragmentedSlugs.toLocaleString()} that remain:`,
    ``,
    "```",
    ...fragAfter.worst.slice(0, 8).flatMap((w) => [w.slug, ...w.keys.map((k) => `    ${k}`)]),
    "```",
    ``,
    `### Grade premiums and characters`,
    ``,
    `| pair | months before → after | latest ratio before → after |`,
    `| --- | --- | --- |`,
    ...PREMIUM_PAIRS.map((pair) => {
      const b = beforePremiums[pair.id];
      const a = ctx.premiumsAfter[pair.id];
      const r = (p?: IndexPoint[]) => (p?.at(-1) ? `${p.at(-1)!.value.toFixed(2)}x on ${p.at(-1)!.n ?? 0}` : "—");
      return `| \`${pair.id}\` | ${b?.length ?? 0} → ${a?.length ?? 0} | ${r(b)} → ${r(a)} |`;
    }),
    ``,
    `Characters: ${Object.keys(charsBefore.characters).length.toLocaleString()} → ${ctx.charactersAfter.characters.toLocaleString()} ` +
      `(with an index: ${Object.values(charsBefore.characters).filter((c) => c.index).length} → ${ctx.charactersAfter.indexed}).`,
    ``,
  ].join("\n");
  writeFileSync(join(ctx.dir, "rekey-report.md"), md);

  console.log(
    `  identities ${rules.keys.before.toLocaleString()} → ${rules.keys.after.toLocaleString()} · fragments ${fragBefore.fragmentKeys.toLocaleString()} → ${fragAfter.fragmentKeys.toLocaleString()} · ` +
      `merges ${mergeTotal.toLocaleString()} (${suspect} with a denominator split) · months +${onlyAfter.length}/−${onlyBefore.length} · ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  console.log(`  wrote rekey-report.json + rekey-report.md + price-index.${PREVIOUS_METHOD}.json + method-changes.json → ${ctx.dir}`);
}

async function main() {
  if (SHADOW && !OUT_DIR) throw new Error("--shadow-rekey requires --out=<dir>: a shadow build never writes production");
  const panel = await buildSalePanel({ legacyIdentity: SHADOW });
  const { series, salesOf, holds, gated, mktSales } = buildSeriesSet(panel);

  // INV-12 input + the disclosure receipt, per entity. The invariance spread IS
  // the "resale skew" every surface prints; past the hard limit the entity is
  // auto-held here and withheld by the reader.
  const invariance = holdingPeriodInvariance(mktSales, { grain: "month" });
  const entities: Record<string, EntityMeta> = {};
  for (const id of Object.keys(series)) {
    const [entity, key] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
    if (entity === "premium") continue; // a ratio has no selection premium of its own
    const inv = holdingPeriodInvariance(salesOf[id], { grain: "month" });
    const skew = Number.isFinite(inv.spreadPP) ? inv.spreadPP : null;
    const anchor = await capAnchor(entity, key, series[id]);
    entities[id] = {
      selectionPremiumPP: skew,
      heldReason: skew != null && skew > INDEX_HARD_SKEW_PP ? "selection-premium" : null,
      anchorPct: anchor.pct,
      anchorSince: anchor.since,
    };
  }
  console.log(
    `  V-MKT holding-period invariance: ${invariance.buckets.map((b) => `${b.label}=${b.perWeekPct.toFixed(2)}%/mo(n=${b.n})`).join(" ")} ` +
      `· spread ${invariance.spreadPP.toFixed(2)}pp · ${invariance.spreadPP > INDEX_HARD_SKEW_PP ? "AUTO-HELD" : invariance.pass ? "pass" : "disclosed"}`,
  );
  for (const [id, m] of Object.entries(entities)) {
    console.log(`  ${id.padEnd(20)} skew ${m.selectionPremiumPP == null ? "—" : m.selectionPremiumPP.toFixed(2) + "pp"} · cap anchor ${m.anchorPct == null ? "—" : (m.anchorPct >= 0 ? "+" : "") + m.anchorPct.toFixed(1) + "%"} since ${m.anchorSince ?? "—"}${m.heldReason ? " · HELD " + m.heldReason : ""}`);
  }

  // ── Grade premiums. Ratios, not indices: no biasTests entry, no hold — a
  //    within-identity ratio has no holding period to be invariant over. Built
  //    over the whole panel so a pair is not starved by one IP's thinness.
  const premiums: Record<string, IndexPoint[]> = {};
  for (const pair of PREMIUM_PAIRS) {
    const s1 = gradePremiumSeries(mktSales, pair.better, pair.worse, { minSales: 1 });
    if (s1.length) premiums[pair.id] = s1;
    const latest = s1[s1.length - 1];
    console.log(
      `  ${pair.id.padEnd(26)} ${String(s1.length).padStart(2)} months` +
        (latest ? ` · latest ${latest.ts.slice(0, 7)} ${latest.value.toFixed(2)}x on ${latest.n} matched identities` : " · none clear the floor"),
    );
  }
  for (const [id, pts] of Object.entries(premiums)) series[id] = pts;

  // INV-13's input AND the published receipt: the per-identity observations
  // behind every published step, lifted OUT of the points (the published
  // `series` shape is unchanged) into a side block keyed entity → point ts →
  // [slug, logReturn, weight, priceFrom, priceTo, nFrom, nTo][].
  //
  // ⚠️ THE SLUG, NOT THE KEY. The key is an internal string that changes with the
  // method (it just did); the slug is the card's URL and is what a reader can
  // click. An identity whose parts cannot name a URL contributes an empty slug
  // rather than being dropped — the estimator's sample must stay complete, or
  // INV-13 would be re-deriving a different median from the one that published.
  const stepObs: Record<string, Record<string, StepObsTuple[]>> = {};
  for (const [id, pts] of Object.entries(series)) {
    for (const pt of pts as (IndexPoint & { obs?: StepObs[] })[]) {
      if (pt.obs) {
        (stepObs[id] ??= {})[pt.ts] = pt.obs.map((o) => [slugOfKey(o.id) ?? "", o.v, o.w, o.priceFrom, o.priceTo, o.nFrom, o.nTo] as StepObsTuple);
        delete pt.obs;
      }
    }
  }
  const nObs = Object.values(stepObs).reduce((a, byTs) => a + Object.values(byTs).reduce((b, o) => b + o.length, 0), 0);
  const nHolds = Object.values(holds).reduce((a, h) => a + h.length, 0);
  let thinPts = 0;
  for (const pts of Object.values(series)) for (const pt of pts) if (pt.thin) thinPts++;
  console.log(`  thin points (overlap < THIN_MONTH_IDENTITIES): ${thinPts} across ${Object.keys(series).length} series`);

  const now = new Date().toISOString();
  const blob = { generatedAt: now, cadence: "monthly" as const, method: METHOD, series, biasTests: { invariance, entities }, stepObs, holds };
  console.log(`  receipts: ${nObs.toLocaleString()} identity observations across ${Object.keys(stepObs).length} series · ${nHolds} withheld months carry their gate`);
  // Persist the panel this run already built, so the identity reader and the
  // palette never build it on a request path (see salePanel.ts). Written FIRST:
  // if the index write below fails, the panel is still fresh for its readers.
  const panelSnap = { generatedAt: now, rows: panel };
  if (OUT_DIR) {
    mkdirSync(OUT_DIR, { recursive: true });
    const pf = join(OUT_DIR, `${SALE_PANEL_SNAPSHOT_KEY}.json`);
    const packed = packSalePanel(panelSnap);
    writeFileSync(pf, JSON.stringify(packed));
    console.log(`  wrote LOCAL sale-panel → ${pf} (${panel.length.toLocaleString()} rows, ${(packed.__gz__.length / 1024).toFixed(0)}KB gz)`);
  } else {
    await writeSalePanel(panelSnap);
    console.log(`  wrote sale-panel snapshot (${panel.length.toLocaleString()} rows)`);
  }

  // The identity index (slug → keys, key → slabs, siblings) — derived from the
  // panel plus the cards dims scan, which is the OTHER 90 s the identity reader
  // must never pay on a request path. Same run, same panel, so the two
  // snapshots agree.
  const tIdx = Date.now();
  const identityIdx = await buildIdentityIndex(panel);
  if (OUT_DIR) {
    const packed = packIdentityIndex(identityIdx, panel.length, now);
    const f1 = join(OUT_DIR, `${IDENTITY_INDEX_SNAPSHOT_KEY}.json`);
    const f2 = join(OUT_DIR, `${IDENTITY_SLABS_SNAPSHOT_KEY}.json`);
    writeFileSync(f1, JSON.stringify(packed.index));
    writeFileSync(f2, JSON.stringify(packed.slabs));
    console.log(
      `  wrote LOCAL identity-index → ${f1} (${identityIdx.bySlug.size.toLocaleString()} slugs, ${(packed.index.__gz__.length / 1024).toFixed(0)}KB gz) ` +
        `+ identity-slabs → ${f2} (${(packed.slabs.__gz__.length / 1024).toFixed(0)}KB gz) in ${((Date.now() - tIdx) / 1000).toFixed(0)}s`,
    );
  } else {
    await writeIdentityIndex(identityIdx, panel.length, now);
    console.log(`  wrote identity-index + identity-slabs snapshots (${identityIdx.bySlug.size.toLocaleString()} slugs, ${((Date.now() - tIdx) / 1000).toFixed(0)}s)`);
  }

  // The character rollups — the identity index grouped by character
  // (src/lib/card/character.ts), each group's KPIs, monthly series, set /
  // venue splits, every identity row and the character index — from the SAME
  // panel and index, in the same run, so the three snapshots agree. Listings
  // are read once for the venue floors. The reader never builds this.
  const tChar = Date.now();
  const listingIdx = await cachedListingIndex().catch(() => null);
  const rollups = buildCharacterRollups(panel, identityIdx, { listings: listingIdx, nowMs: Date.parse(now) });
  // Card art for the page headers: one meta read per platform over the leading
  // slabs (a READ of `cards`, the table the panel's dims come from). A failed
  // read leaves every image null; the pages fall back to the IP icon.
  const nArt = await resolveCharacterArt(rollups).catch((e: unknown) => {
    console.warn(`  character art unresolved: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  });
  const nChars = Object.keys(rollups.characters).length;
  const nIndexed = Object.values(rollups.characters).filter((c) => c.index).length;
  const covTxt = Object.entries(rollups.coverage)
    .map(([ip, c]) => `${ip} ${c.mapped.toLocaleString()}/${c.identities.toLocaleString()} mapped (${c.identities ? ((c.mapped / c.identities) * 100).toFixed(1) : "0.0"}%), ${c.multiCharacter} multi-character`)
    .join(" · ");
  if (OUT_DIR) {
    const packed = packCharacterRollups(rollups);
    const f = join(OUT_DIR, `${CHARACTER_ROLLUPS_SNAPSHOT_KEY}.json`);
    writeFileSync(f, JSON.stringify(packed));
    console.log(
      `  wrote LOCAL character-rollups → ${f} (${nChars.toLocaleString()} characters, ${nIndexed} with an index, ${nArt} with art, ${(packed.__gz__.length / 1024).toFixed(0)}KB gz) ` +
        `in ${((Date.now() - tChar) / 1000).toFixed(1)}s · ${covTxt}`,
    );
  } else {
    await writeCharacterRollups(rollups);
    console.log(`  wrote character-rollups snapshot (${nChars.toLocaleString()} characters, ${nIndexed} with an index, ${nArt} with art, ${((Date.now() - tChar) / 1000).toFixed(1)}s) · ${covTxt}`);
  }

  const blobJson = JSON.stringify(blob);
  if (OUT_DIR) {
    mkdirSync(OUT_DIR, { recursive: true });
    const file = join(OUT_DIR, "price-index.json");
    writeFileSync(file, blobJson);
    console.log(`  wrote LOCAL blob → ${file} (production untouched)`);
  } else {
    await writeSnapshot("price-index", blob, now);
  }
  console.log(`  price-index blob: ${(blobJson.length / 1024 / 1024).toFixed(2)} MB raw · ${(gzipSync(Buffer.from(blobJson)).length / 1024).toFixed(0)} KB gz`);

  // ── The method ledger. Only a shadow build can measure a method change, so the
  //    real run publishes the file one wrote; without the flag the ledger is left
  //    exactly as it is. Append-only in both directions.
  if (METHOD_CHANGES_FILE) {
    const incoming = JSON.parse(readFileSync(METHOD_CHANGES_FILE, "utf8")) as { changes: MethodChange[] };
    const current = (await readSnapshot<{ changes?: MethodChange[] }>(METHOD_CHANGES_SNAPSHOT_KEY))?.changes ?? [];
    const next = appendMethodChanges(current, incoming.changes ?? []);
    const payload = { generatedAt: now, changes: next };
    if (OUT_DIR) {
      writeFileSync(join(OUT_DIR, `${METHOD_CHANGES_SNAPSHOT_KEY}.json`), JSON.stringify(payload));
      console.log(`  wrote LOCAL method-changes (${next.length} records; ${next.length - current.length} new)`);
    } else {
      await writeSnapshot(METHOD_CHANGES_SNAPSHOT_KEY, payload, now);
      console.log(`  wrote method-changes snapshot (${next.length} records; ${next.length - current.length} new)`);
    }
  }

  if (SHADOW && OUT_DIR) {
    await writeShadowRekey({ dir: OUT_DIR, now, panel, after: series, afterSalesOf: salesOf, holds, identityIdx, charactersAfter: { characters: nChars, indexed: nIndexed, coverage: rollups.coverage }, premiumsAfter: premiums });
  }

  const published = Object.keys(series);
  console.log(
    `Wrote price-index: ${published.length} series from ${panel.length} panel sales · ` +
      `published: ${published.join(", ") || "none"} · gated(thin): ${gated.join(", ") || "none"}`,
  );
  return { rowsWritten: published.length };
}

// ⚠️ `--out` is the executor's production-free mode: it must not stamp
// production's `source_freshness` either, or /status reports a price-index run
// that never reached the production blobs. Only the real run goes through
// runWarmer; the local one is a bare call.
(OUT_DIR ? main() : runWarmer("price-index", main)).catch((e) => {
  console.error(e);
  process.exit(1);
});
