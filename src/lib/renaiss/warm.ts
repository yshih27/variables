/**
 * The two Renaiss warmers' shared engine. scripts/warm-renaiss-sales.ts and
 * scripts/warm-renaiss-pulls.ts are thin wrappers around `runRenaissWarmer`.
 *
 *   npx tsx scripts/warm-renaiss-sales.ts                          # DRY RUN, incremental (the default)
 *   npx tsx scripts/warm-renaiss-sales.ts --apply                  # incremental, writes
 *   npx tsx scripts/warm-renaiss-sales.ts --backfill --apply       # from the oldest row, writes
 *   npx tsx scripts/warm-renaiss-pulls.ts --dry-run --limit 3      # at most 3 pages, writes nothing
 *   npx tsx scripts/warm-renaiss-pulls.ts --dry-run --limit 3 --fixture=a.json,b.json
 *                                         # replays saved responses: no API call, no key needed
 *
 * ⚠️ DRY RUN UNLESS --apply. A dry run fetches, maps and prints the report
 * below; it writes no row, no card, no feed state and no freshness row.
 * `--dry-run` is accepted and wins over `--apply`.
 * ⚠️ NO KEY, NO RUN (client.ts): without both secrets the warmer prints one line
 * and exits 0, before any request.
 *
 * Incremental starts: sales from a day before the newest stored sale; pulls
 * from the earlier of that and 14 days ago, so prizes named late are picked up.
 * The feeds are oldest-first and cursor-paged, and every write is an upsert on
 * the feed's own id, so the overlap costs requests, never duplicates.
 *
 * A run stopped by the call ceiling or a rate limit keeps every page it wrote,
 * records how far it got, and then FAILS: the store is behind, the freshness
 * gate should say so, and the next run continues from the stored cursor.
 *
 * `--compare-sets` (report only): reads every `cards` row once (the dims scan,
 * read-only) to say which Renaiss set strings reach a set key another venue's
 * cards already carry — the ones that do not are the set-alias brief's input.
 */
import { readFileSync } from "node:fs";
import {
  noKeyExit,
  pageFeed,
  renaissCallCount,
  lastRateLimit,
  RENAISS_PAGE_SIZE,
  type FeedPage,
  type FeedQuery,
  type PagedRun,
  type RenaissEnv,
} from "./client";
import {
  fetchSalesPage,
  latestStoredSoldAt,
  linkedCardOfSale,
  salesIncrementalFrom,
  toStoredSale,
  upsertRenaissSales,
  type RenaissSaleRow,
} from "./sales";
import {
  fetchPullsPage,
  latestStoredPulledAt,
  linkedCardOfPull,
  pullsIncrementalFrom,
  toPullRow,
  upsertRenaissPulls,
  usdOf,
  type RenaissPullRow,
} from "./pulls";
import {
  collectCardRows,
  composeGrade,
  filterUnseenCards,
  renaissIdentityParts,
  upsertRenaissCards,
  type FeedCatalogCard,
  type FeedSlab,
  type RenaissCardRow,
} from "./cards";
import { recordFeedRun, type RenaissFeed } from "./feedState";
import { runWarmer } from "../db/runWarmer";
import { duneSpend } from "../dune/client";
import { identityKeyRefusal, languageOfField } from "../data/traits";
import { readAllCardDims } from "../data/cards";
import { normalizeSetName } from "../card/setName";
import { cleanSecondarySales, formatHygiene } from "../data/secondaryHygiene";

export type WarmArgs = {
  apply: boolean;
  backfill: boolean;
  pageLimit: number;
  from: string | null;
  fixture: string[] | null;
  compareSets: boolean;
};

/** Flags → args. Throws on a malformed value. */
export function parseWarmArgs(argv: string[]): WarmArgs {
  const value = (name: string): string | null => {
    const eq = argv.find((a) => a.startsWith(`${name}=`));
    if (eq) return eq.slice(name.length + 1);
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? "") : null;
  };
  let pageLimit = Infinity;
  const limitRaw = value("--limit");
  if (limitRaw != null) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`--limit requires a positive integer (pages), got: ${limitRaw || "(nothing)"}`);
    pageLimit = n;
  }
  const from = value("--from");
  if (from != null && !Number.isFinite(Date.parse(from))) throw new Error(`--from requires an ISO 8601 time, got: ${from || "(nothing)"}`);
  const fixture = value("--fixture");
  return {
    apply: argv.includes("--apply") && !argv.includes("--dry-run"),
    backfill: argv.includes("--backfill"),
    pageLimit,
    from,
    fixture: fixture ? fixture.split(",").map((f) => f.trim()).filter(Boolean) : null,
    compareSets: argv.includes("--compare-sets"),
  };
}

type Linked = { tokenId: string; slab: FeedSlab; card: FeedCatalogCard };

/** What differs between the two feeds; everything else is `runFeed`. */
type FeedSpec<Row> = {
  feed: RenaissFeed;
  source: "renaiss-sales" | "renaiss-pulls";
  noun: string;
  rowsKey: "sales" | "pulls";
  fetchPage: (q: FeedQuery) => Promise<FeedPage<Row>>;
  newestStored: () => Promise<string | null>;
  incrementalFrom: (newest: string | null) => string | null;
  timeOf: (r: Row) => string;
  linked: (r: Row) => Linked | null;
  write: (rows: Row[], cards: Map<string, RenaissCardRow>) => Promise<number>;
  mapped: (r: Row, card: RenaissCardRow | null) => Record<string, unknown>;
  summary: (rows: Row[]) => string[];
};

/** Replays saved responses (one object, or an array of pages, per file) in order. */
function fixturePager<Row>(files: string[], key: "sales" | "pulls"): (q: FeedQuery) => Promise<FeedPage<Row>> {
  const pages: { rows: Row[]; nextCursor: string | null }[] = [];
  for (const f of files) {
    const body = JSON.parse(readFileSync(f, "utf8")) as unknown;
    for (const b of (Array.isArray(body) ? body : [body]) as Record<string, unknown>[]) {
      pages.push({ rows: (b[key] as Row[] | undefined) ?? [], nextCursor: (b.nextCursor as string | null | undefined) ?? null });
    }
  }
  let i = 0;
  return async () => {
    const p = pages[i++];
    if (!p) return { rows: [], nextCursor: null, hasMore: false, rate: null };
    return { rows: p.rows, nextCursor: p.nextCursor ?? `fixture-page-${i}`, hasMore: i < pages.length, rate: null };
  };
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function tally<K>(): { add: (k: K, n?: number) => void; sorted: () => [K, number][] } {
  const m = new Map<K, number>();
  return {
    add: (k, n = 1) => void m.set(k, (m.get(k) ?? 0) + n),
    sorted: () => [...m].sort((a, b) => b[1] - a[1]),
  };
}

function salesSpec(env: RenaissEnv, fixture: string[] | null): FeedSpec<RenaissSaleRow> {
  return {
    feed: "sales",
    source: "renaiss-sales",
    noun: "sales",
    rowsKey: "sales",
    fetchPage: fixture ? fixturePager<RenaissSaleRow>(fixture, "sales") : (q) => fetchSalesPage(q, env),
    newestStored: latestStoredSoldAt,
    incrementalFrom: salesIncrementalFrom,
    timeOf: (r) => r.soldAt,
    linked: linkedCardOfSale,
    write: (rows) => upsertRenaissSales(rows.map(toStoredSale)),
    mapped: (r) => ({ ...toStoredSale(r), raw: "(the feed row, verbatim)" }),
    summary: (rows) => {
      const priced = rows.map((r) => (r.priceUsdCents ?? NaN) / 100).filter((n) => n > 0);
      const buyers = new Set(rows.map((r) => r.buyer?.toLowerCase()).filter(Boolean));
      const sellers = new Set(rows.map((r) => r.seller?.toLowerCase()).filter(Boolean));
      const currencies = tally<string>();
      for (const r of rows) currencies.add(r.currency);
      const linked = rows.filter((r) => r.slab && r.catalogCard).length;
      const { stats } = cleanSecondarySales(
        rows.map((r) => toStoredSale(r)).map((s) => ({ date: s.sold_at, tokenId: s.token_id, buyer: s.buyer ?? "", seller: s.seller ?? "", priceUsd: s.price_usd ?? 0 })).filter((s) => s.priceUsd > 0),
      );
      return [
        `sales: ${rows.length} · ${usd(priced.reduce((a, b) => a + b, 0))} buyer-paid · median ${usd(median(priced))} · ${buyers.size} buyers · ${sellers.size} sellers · currency ${currencies.sorted().map(([c, n]) => `${c} ×${n}`).join(", ")}`,
        `linked to a cert and a card: ${linked} of ${rows.length} (${rows.length - linked} unlinked → no cards row until linked)`,
        formatHygiene("renaiss-sales", stats)?.trim() ?? `hygiene: nothing removed (${stats.input} priced rows)`,
      ];
    },
  };
}

function pullsSpec(env: RenaissEnv, fixture: string[] | null): FeedSpec<RenaissPullRow> {
  const cardOf = (p: RenaissPullRow, cards: Map<string, RenaissCardRow>) => (p.tokenId ? (cards.get(`rn-${p.tokenId}`) ?? null) : null);
  return {
    feed: "pulls",
    source: "renaiss-pulls",
    noun: "pack pulls",
    rowsKey: "pulls",
    fetchPage: fixture ? fixturePager<RenaissPullRow>(fixture, "pulls") : (q) => fetchPullsPage(q, env),
    newestStored: latestStoredPulledAt,
    incrementalFrom: (newest) => pullsIncrementalFrom(newest),
    timeOf: (p) => p.pulledAt,
    linked: linkedCardOfPull,
    write: (rows, cards) => upsertRenaissPulls(rows.map((p) => toPullRow(p, cardOf(p, cards)))),
    mapped: (p, card) => toPullRow(p, card),
    summary: (rows) => {
      const checkout = rows.filter((p) => p.kind === "checkout");
      const observed = rows.length - checkout.length;
      const spend = checkout.map((p) => usdOf(p.pricePaid)).filter((n): n is number => n != null);
      const unpriced = checkout.length - spend.length;
      const stated = rows.map((p) => usdOf(p.prizeValue)).filter((n): n is number => n != null);
      const machines = tally<string>();
      for (const p of rows) machines.add(p.machineName ?? `(unnamed) ${p.machineId}`);
      const buyers = new Set(checkout.map((p) => p.buyer?.toLowerCase()).filter(Boolean));
      const named = rows.filter((p) => p.tokenId).length;
      return [
        `packs: ${rows.length} pulls · ${checkout.length} checkout · ${observed} observed (stored, never spend) · ${unpriced} checkout without a dollar price`,
        `pack spend ${usd(spend.reduce((a, b) => a + b, 0))} (USDT as USD) · ${buyers.size} buyers · ${machines.sorted().length} machines: ${machines.sorted().map(([m, n]) => `${m} ×${n}`).join(", ")}`,
        `prizes named: ${named} of ${rows.length} · stated prize value on ${stated.length}, ${usd(stated.reduce((a, b) => a + b, 0))} as stated by Renaiss`,
      ];
    },
  };
}

type Ctx = { env: RenaissEnv; log: (line: string) => void };

async function runFeed<Row>(spec: FeedSpec<Row>, args: WarmArgs, ctx: Ctx): Promise<{ rowsWritten: number }> {
  const { log } = ctx;
  const t0 = Date.now();

  let from: string | null = null;
  let start: string;
  if (args.fixture) start = `replaying ${args.fixture.length} saved response file(s), no API call`;
  else if (args.from) {
    from = args.from;
    start = `from ${from} (--from)`;
  } else if (args.backfill) start = "BACKFILL from the oldest row";
  else {
    const newest = await spec.newestStored().catch((e) => {
      log(`  store not readable (${(e as Error).message.slice(0, 120)}) → reading from the oldest row`);
      return null;
    });
    from = spec.incrementalFrom(newest);
    start = from ? `incremental from ${from} (newest stored ${newest})` : "first run (nothing stored) → from the oldest row";
  }
  log(
    `Renaiss ${spec.noun} — ${start}` +
      `${Number.isFinite(args.pageLimit) ? ` · capped at ${args.pageLimit} page(s)` : ""}` +
      `${args.apply ? "" : " · DRY RUN (no writes)"}`,
  );

  const all: Row[] = [];
  /** Where each page starts in `all` — the report shows rows from every page. */
  const pageStarts: number[] = [];
  const cards = new Map<string, RenaissCardRow>();
  const slabs = new Map<string, FeedSlab>();
  const writtenCards = new Set<string>();
  let rowsWritten = 0;
  let cardsWritten = 0;

  const result: PagedRun = await pageFeed<Row>({
    fetchPage: spec.fetchPage,
    from,
    limit: RENAISS_PAGE_SIZE,
    maxPages: args.pageLimit,
    onPage: async (rows, info) => {
      const linked = rows.map(spec.linked).filter((l): l is Linked => l !== null);
      const pageCards = collectCardRows(linked);
      for (const c of pageCards) cards.set(c.id, c);
      for (const l of linked) slabs.set(`rn-${l.tokenId}`, l.slab);
      if (args.apply) {
        const unseen = await filterUnseenCards(pageCards.filter((c) => !writtenCards.has(c.id)));
        cardsWritten += await upsertRenaissCards(unseen);
        for (const c of pageCards) writtenCards.add(c.id);
        rowsWritten += await spec.write(rows, cards);
      }
      pageStarts.push(all.length);
      all.push(...rows);
      const first = rows[0] ? spec.timeOf(rows[0]).slice(0, 16) : "—";
      const last = rows.length ? spec.timeOf(rows[rows.length - 1]).slice(0, 16) : "—";
      log(
        `  page ${String(info.page).padStart(4)} · ${String(rows.length).padStart(3)} rows · ${first} → ${last}` +
          ` · ${pageCards.length} slabs named · X-RateLimit-Remaining ${info.rate?.remaining ?? (args.fixture ? "— (fixture)" : "?")}`,
      );
    },
  });

  let newest: string | null = null;
  if (args.apply) {
    newest = await spec.newestStored();
    await recordFeedRun(spec.feed, { stoppedBy: result.stoppedBy, newestRowAt: newest });
  }

  const d = duneSpend();
  const stop = args.fixture && result.stoppedBy === "caught-up" ? "the replay ended" : result.stoppedBy;
  log(
    `\n${args.apply ? "Wrote" : "Would write"} ${(args.apply ? rowsWritten : all.length).toLocaleString()} ${spec.noun} rows · ` +
      `${(args.apply ? cardsWritten : cards.size).toLocaleString()} cards rows${args.apply ? " (first sighting only)" : " (one per slab named; a real run writes only the ones not stored yet)"} · ` +
      `${renaissCallCount()} API calls · ${result.pages} page(s) · stopped: ${stop}${result.detail ? ` (${result.detail})` : ""} · ` +
      `X-RateLimit-Remaining ${lastRateLimit().remaining ?? "—"} · Dune ${d.calls} calls, ${d.datapoints} datapoints (credit meter) · ` +
      `${((Date.now() - t0) / 1000).toFixed(1)}s${newest ? ` · newest stored ${newest}` : ""}`,
  );

  if (!args.apply) await printReport(spec, all, pageStarts, cards, slabs, args, log);

  if (result.stoppedBy === "ceiling" || result.stoppedBy === "rate-limited") {
    throw new Error(
      `${spec.source}: ${result.detail ?? result.stoppedBy}. ${args.apply ? `${rowsWritten} rows kept; the next run continues from the stored cursor.` : "Dry run: nothing written."}`,
    );
  }
  return { rowsWritten };
}

/** The dry-run report: the mapped rows, the grade and identity results, the set strings. */
async function printReport<Row>(
  spec: FeedSpec<Row>,
  rows: Row[],
  pageStarts: number[],
  cards: Map<string, RenaissCardRow>,
  slabs: Map<string, FeedSlab>,
  args: WarmArgs,
  log: (l: string) => void,
) {
  log(`\n── Report (${rows.length} ${spec.noun} rows, ${cards.size} distinct slabs named) ──`);
  for (const line of spec.summary(rows)) log(`  ${line}`);

  // The first page's first three rows, then each later page's first row.
  const shown = [...rows.slice(0, Math.min(3, pageStarts[1] ?? rows.length)), ...pageStarts.slice(1).map((i) => rows[i])];
  log(`\n  Mapped rows (the first page's first 3, then each later page's first, as they would be written):`);
  for (const r of shown) {
    const l = spec.linked(r);
    const card = l ? (cards.get(`rn-${l.tokenId}`) ?? null) : null;
    log(`  ${spec.rowsKey === "sales" ? "renaiss_sales" : "gacha_pulls"} ${JSON.stringify(spec.mapped(r, card))}`);
    if (card) {
      log(`    → cards ${JSON.stringify({ ...card, attributes: `(${card.attributes?.length ?? 0} label/value pairs)` })}`);
    } else {
      log(`    → cards: none (${spec.rowsKey === "sales" ? "not linked to a cert and a card yet" : "prize not named yet"})`);
    }
  }

  // Everything below is per distinct slab: a slab on several rows counts once.
  const grades = tally<string>();
  const langs = tally<string>();
  const refusals = tally<string>();
  const ips = tally<string>();
  const sets = new Map<string, { n: number; key: string | null; lang: string | null }>();
  let keyed = 0;
  for (const c of cards.values()) {
    const slab = slabs.get(c.id);
    if (slab) {
      const g = composeGrade(slab);
      grades.add(`${slab.company ?? "(no company)"} · "${slab.grade ?? "(no grade)"}" → ${g.label} (${g.via})`);
    }
    const parts = renaissIdentityParts(c);
    langs.add(`${c.language ?? "(none)"} → ${languageOfField(c.language) ?? "unmarked (English default)"}`);
    const why = identityKeyRefusal(parts);
    if (why) refusals.add(why);
    else keyed++;
    ips.add(c.ip_key);
    const s = c.set_name ?? "(no set)";
    const id = normalizeSetName(c.set_name);
    const cur = sets.get(s) ?? { n: 0, key: id.key ?? (id.slug || null), lang: id.language };
    cur.n++;
    sets.set(s, cur);
  }
  log(`\n  Grades (per slab, composed through parseGrade):`);
  for (const [k, n] of grades.sorted()) log(`    ${k} ×${n}`);
  log(`\n  Identity: ${keyed} of ${cards.size} slabs key to an identity; refused: ${refusals.sorted().map(([k, n]) => `${k} ×${n}`).join(", ") || "none"}`);
  log(`    language field → identity language: ${langs.sorted().map(([k, n]) => `${k} ×${n}`).join(" · ")}`);
  log(`    ip: ${ips.sorted().map(([k, n]) => `${k} ×${n}`).join(" · ")}`);
  for (const c of [...cards.values()].filter((c) => c.ip_key === "other").slice(0, 10)) {
    const code = c.attributes?.find((a) => a.trait_type === "Set ID")?.value;
    log(`      other: ${c.card_name} · ${c.set_name ?? "(no set)"} · set code ${code ?? "none"} · image ${c.image ? new URL(c.image).pathname.split("/").slice(1, 2).join("") : "none"}/…`);
  }

  let known: Set<string> | null = null;
  if (args.compareSets) {
    known = new Set<string>();
    const dims = await readAllCardDims();
    for (const [platform, m] of dims) {
      if (platform === "renaiss") continue;
      for (const dd of m.values()) if (dd.setKey) known.add(dd.setKey);
    }
  }
  const setRows = [...sets].sort((a, b) => b[1].n - a[1].n);
  if (known) {
    const unrec = setRows.filter(([, v]) => !v.key || !known!.has(v.key));
    log(`\n  Set strings: ${setRows.length} distinct; ${setRows.length - unrec.length} reach a set key another venue's cards carry, ${unrec.length} do not:`);
    for (const [s, v] of unrec) log(`    "${s}" → ${v.key ?? "(junk)"}${v.lang ? ` [${v.lang}]` : ""} ×${v.n}`);
  } else {
    log(`\n  Set strings: ${setRows.length} distinct (not compared with the other venues' set keys; pass --compare-sets):`);
    for (const [s, v] of setRows) log(`    "${s}" → ${v.key ?? "(junk)"}${v.lang ? ` [${v.lang}]` : ""} ×${v.n}`);
  }
}

/**
 * One warmer run. Resolves to the exit code: 0 for a finished run or the
 * no-key exit, 1 for bad flags; throws when a run fails or stops short (the
 * ceiling, a rate limit), after keeping what it wrote.
 */
export async function runRenaissWarmer(
  feed: RenaissFeed,
  argv: string[],
  deps: { env?: RenaissEnv; log?: (line: string) => void } = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((l: string) => console.log(l));
  let args: WarmArgs;
  try {
    args = parseWarmArgs(argv);
  } catch (e) {
    log(`✗ ${(e as Error).message}`);
    return 1;
  }
  if (args.fixture && args.apply) {
    log("✗ --fixture replays saved responses and is a dry run only; drop --apply.");
    return 1;
  }
  if (args.backfill && args.from) {
    log("✗ --backfill starts at the oldest row and --from at a time; pass one.");
    return 1;
  }
  if (!args.fixture && noKeyExit(env, log)) return 0;

  const ctx: Ctx = { env, log };
  if (feed === "sales") {
    const spec = salesSpec(env, args.fixture);
    const run = () => runFeed(spec, args, ctx);
    // A dry run must not touch source_freshness: it would advertise a warm that wrote nothing.
    await (args.apply ? runWarmer(spec.source, run) : run());
  } else {
    const spec = pullsSpec(env, args.fixture);
    const run = () => runFeed(spec, args, ctx);
    await (args.apply ? runWarmer(spec.source, run) : run());
  }
  return 0;
}
