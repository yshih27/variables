/**
 * test:renaiss — the Renaiss venue's mappers, grade rule, identity quirk,
 * paging and budget guards, on the saved samples.
 *
 * Fixtures (src/lib/renaiss/fixtures/), saved from api.renaissos.com on Sep 30,
 * 2026 on the anonymous tier and kept verbatim:
 *   sales-oldest.json   GET /v1/renaiss/sales?limit=3 — the three oldest sales (Jan 9, 2026)
 *   sales-week.json     the 46 sales of Sep 23–30 (hasMore false)
 *   pulls-oldest.json   GET /v1/gacha/pulls?platform=renaiss&limit=3 — the three oldest pulls (Nov 6, 2025; unnamed)
 *   pulls-week.json     500 pulls from Sep 23 00:00 UTC (hasMore true)
 *   constructed.json    CONSTRUCTED, labelled so inside: an unlinked sale and an observed pull,
 *                       which the samples do not contain, built from real rows per the spec.
 *
 * No test touches the network or the database: the transport is swapped
 * through `resetRenaissClient`, and every warmer run here is a dry run.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NO_KEY_LINE,
  noKeyExit,
  pageFeed,
  renaissCallCount,
  renaissCredentials,
  renaissGet,
  resetRenaissClient,
  retryAfterSeconds,
  type FeedQuery,
} from "./client";
import { linkedCardOfSale, salesIncrementalFrom, toStoredSale, toNormalizedSales, type RenaissSaleRow } from "./sales";
import { linkedCardOfPull, packWindows, pullsIncrementalFrom, toPullRow, type RenaissPullRow } from "./pulls";
import { composeGrade, renaissCardRow } from "./cards";
import { feedIsCurrent, lastCompleteDay, nextFeedState } from "./feedState";
import { runRenaissWarmer } from "./warm";
import { extractCardIdentity, identityKey, identityKeyRefusal, languageOfField } from "../data/traits";

const FIX = join(__dirname, "fixtures");
const load = <T>(name: string): T => JSON.parse(readFileSync(join(FIX, name), "utf8")) as T;
const salesOldest = load<{ sales: RenaissSaleRow[] }>("sales-oldest.json").sales;
const salesWeek = load<{ sales: RenaissSaleRow[] }>("sales-week.json").sales;
const pullsOldest = load<{ pulls: RenaissPullRow[] }>("pulls-oldest.json").pulls;
const pullsWeek = load<{ pulls: RenaissPullRow[] }>("pulls-week.json").pulls;
const constructed = load<{ unlinkedSale: RenaissSaleRow; observedPull: RenaissPullRow }>("constructed.json");

const KEYS = { RENAISS_API_KEY: "rk_test", RENAISS_API_SECRET: "rsk_test" };
const noSleep = async () => undefined;

beforeEach(() => resetRenaissClient({ sleep: noSleep }));

// ── Row mappers ───────────────────────────────────────────────────────────────

test("a linked sale maps to its stored row and its cards row", () => {
  const sale = salesOldest[0]; // Kecleon, SV8 #118, PSA 10, $30.60, Jan 9
  const stored = toStoredSale(sale);
  assert.equal(stored.sale_id, `${sale.txHash}:${sale.logIndex}`);
  assert.equal(stored.price, "30.6");
  assert.equal(stored.price_usd, 30.6);
  assert.equal(stored.currency, "USDT");
  assert.equal(stored.cert, "PSA119571435");
  assert.equal(stored.grader, "PSA");
  assert.equal(stored.grade_raw, "10 Gem Mint");
  assert.equal(stored.card_name, "Kecleon");
  assert.equal(stored.set_name, "Super Electric Breaker");
  assert.equal(stored.set_code, "SV8");
  assert.equal(stored.card_number, "118");
  assert.equal(stored.year, 2024);
  assert.equal(stored.language, "Japanese");
  assert.equal(stored.seller, sale.seller!.toLowerCase());
  assert.deepEqual(stored.raw, sale);

  const linked = linkedCardOfSale(sale);
  assert.ok(linked);
  const card = renaissCardRow(linked.tokenId, linked.slab, linked.card);
  assert.equal(card.id, `rn-${sale.tokenId}`);
  assert.equal(card.platform, "renaiss");
  assert.equal(card.chain, "BNB Chain");
  assert.equal(card.source, "renaiss-api");
  assert.equal(card.name, "Kecleon");
  assert.equal(card.card_name, "Kecleon");
  assert.equal(card.set_name, "Super Electric Breaker");
  assert.equal(card.card_number, "118");
  assert.equal(card.grade_label, "PSA 10");
  assert.equal(card.grade, "10 Gem Mint");
  assert.equal(card.grader, "PSA");
  assert.equal(card.grade_num, 10);
  assert.equal(card.cert, "PSA119571435");
  assert.equal(card.year, 2024);
  assert.equal(card.language, "Japanese");
  assert.equal(card.ip_key, "pokemon");
  assert.match(card.image ?? "", /^https:\/\/bhshyxmgzwogzgcf\.public\.blob\.vercel-storage\.com\//);
  assert.equal(card.insured_value_usd, null);
  assert.ok(card.identity_key?.endsWith("|Japanese"), card.identity_key ?? "no key");
  assert.ok(card.identity_slug?.endsWith("/jp"), card.identity_slug ?? "no slug");
});

test("an unlinked sale is stored with no card fields and writes no cards row", () => {
  const sale = constructed.unlinkedSale;
  const stored = toStoredSale(sale);
  assert.equal(stored.sale_id, sale.id);
  assert.ok(stored.price_usd! > 0);
  for (const k of ["cert", "grader", "grade_raw", "catalog_id", "renaiss_item_id", "card_name", "set_name", "set_code", "card_number", "year", "language", "image_url"] as const) {
    assert.equal(stored[k], null, k);
  }
  assert.equal(linkedCardOfSale(sale), null);
});

test("a named pull maps to gacha_pulls with its prize and the prize's identity", () => {
  const pull = pullsWeek[0]; // PANDORA 28, $28, Larvitar PSA 8, stated value $20.50
  const linked = linkedCardOfPull(pull);
  assert.ok(linked);
  const card = renaissCardRow(linked.tokenId, linked.slab, linked.card);
  const row = toPullRow(pull, card);
  assert.deepEqual(row, {
    pull_id: pull.id,
    platform_id: "renaiss",
    product_id: "4c3263d7-8aab-4498-af7b-2c8a7c484a55",
    buyer: pull.buyer!.toLowerCase(),
    price_usd: 28,
    prize_instance_id: `rn-${pull.tokenId}`,
    prize_canonical_id: card.identity_key,
    prize_value_usd: 20.5,
    tx_hash: pull.transaction,
    source: "renaiss-api",
    pulled_at: "2026-09-23T00:00:36.000Z",
  });
  assert.ok(card.identity_key);
  assert.equal(card.grade_label, "PSA 8");
});

test("an unnamed pull keeps its spend and has no prize yet", () => {
  const pull = pullsOldest[0];
  assert.equal(linkedCardOfPull(pull), null);
  const row = toPullRow(pull, null);
  assert.equal(row.price_usd, 30);
  assert.equal(row.buyer, pull.buyer);
  assert.equal(row.prize_instance_id, null);
  assert.equal(row.prize_canonical_id, null);
  assert.equal(row.prize_value_usd, null);
  assert.equal(row.tx_hash, pull.transaction);
});

test("an observed pull is stored with price null and never counts as spend", () => {
  const pull = constructed.observedPull;
  const row = toPullRow(pull, null);
  assert.equal(row.price_usd, null);
  assert.equal(row.buyer, null);
  assert.equal(row.prize_instance_id, `rn-${pull.tokenId}`);
  assert.equal(row.prize_value_usd, 20.5);
  // Even if the feed ever sent a price on an observed row, it is not spend.
  assert.equal(toPullRow({ ...pull, pricePaid: { amount: "28", currency: "USDT" } }, null).price_usd, null);
  // The spend windows only ever see priced (checkout) rows.
  const now = Date.parse("2026-09-23T06:00:00Z");
  const spend = [pullsWeek[0], pull]
    .map((p) => toPullRow(p, null))
    .filter((r) => r.price_usd != null)
    .map((r) => ({ pulledAt: r.pulled_at, usd: r.price_usd! }));
  assert.deepEqual(packWindows(spend, now), { gachaVol24Usd: 28, gachaVol7Usd: 28, gachaSales24h: 1 });
});

test("the IP comes from the catalog image's game before any keyword", () => {
  // "Sunflora" holds "nfl": a keyword-first read files this Pokémon card under football.
  const sunflora = pullsWeek.find((p) => p.catalogCard?.name === "Sunflora");
  assert.ok(sunflora, "sample has the Sunflora pull");
  const l = linkedCardOfPull(sunflora)!;
  assert.equal(renaissCardRow(l.tokenId, l.slab, l.card).ip_key, "pokemon");
  // One Piece by its image; an image that names no game falls back to keywords and the set code.
  const zoro = salesWeek.find((s) => s.catalogCard?.setCode === "OP06")!;
  assert.equal(renaissCardRow(zoro.tokenId, zoro.slab!, zoro.catalogCard!).ip_key, "one_piece");
  const opaque = { ...zoro.catalogCard!, imageUrl: "https://bhshyxmgzwogzgcf.public.blob.vercel-storage.com/items/0000/lg.webp" };
  assert.equal(renaissCardRow(zoro.tokenId, zoro.slab!, opaque).ip_key, "one_piece");
});

// ── Grade composition ───────────────────────────────────────────────────────

test("grade labels compose as <company> <numeric grade> through parseGrade", () => {
  const g = (company: string | null, grade: string | null, cert = "PSA1") => composeGrade({ cert, company, grade });
  assert.deepEqual(g("PSA", "10 Gem Mint"), { label: "PSA 10", grader: "PSA", gradeNum: 10, via: "parseGrade" });
  assert.deepEqual(g("PSA", "9 Mint"), { label: "PSA 9", grader: "PSA", gradeNum: 9, via: "parseGrade" });
  assert.deepEqual(g("PSA", "GEM MT 10"), { label: "PSA 10", grader: "PSA", gradeNum: 10, via: "parseGrade" });
  assert.deepEqual(g("CGC", "10 Pristine", "CGC4123"), { label: "CGC 10", grader: "CGC", gradeNum: 10, via: "parseGrade" });
  // A null company falls back to the cert's prefix.
  assert.equal(g(null, "8 NM-MT", "PSA142678133").label, "PSA 8");
  // Every grade string in the samples composes through parseGrade.
  for (const r of [...salesWeek, ...pullsWeek]) {
    if (!r.slab) continue;
    assert.equal(composeGrade(r.slab).via, "parseGrade", `${r.slab.company} ${r.slab.grade}`);
  }
});

// ── The identity quirk ──────────────────────────────────────────────────────

test("renaiss identity: set, number and language from the fields (Japanese set)", () => {
  const sale = salesWeek.find((s) => s.catalogCard?.setName === "Pokémon Card 151" && s.catalogCard.language === "Japanese");
  assert.ok(sale, "sample has a Japanese Pokémon Card 151 sale");
  const l = linkedCardOfSale(sale)!;
  const card = renaissCardRow(l.tokenId, l.slab, l.card);
  const parts = extractCardIdentity({
    platform: "renaiss",
    name: card.name,
    cardName: card.card_name,
    set: card.set_name,
    grade: card.grade_label,
    year: card.year,
    cardNumber: card.card_number,
    language: card.language,
  });
  assert.equal(parts.language, "Japanese");
  assert.equal(parts.set, "Pokémon Card 151");
  assert.equal(parts.number, l.card.cardNumber!.toUpperCase());
  const key = identityKey("pokemon", parts)!;
  // "Pokémon Card 151" folds onto the English set's key "151"; the language keeps the two apart.
  assert.equal(key.split("|")[1], "151");
  assert.ok(key.endsWith("|Japanese"));
  assert.notEqual(key, identityKey("pokemon", { ...parts, language: null }));
});

test("renaiss identity: an English-set row is the unmarked default", () => {
  const sale = salesWeek.find((s) => s.catalogCard?.language === "English");
  assert.ok(sale, "sample has an English sale");
  const l = linkedCardOfSale(sale)!;
  const card = renaissCardRow(l.tokenId, l.slab, l.card);
  const parts = extractCardIdentity({ platform: "renaiss", name: card.name, cardName: card.card_name, set: card.set_name, grade: card.grade_label, year: card.year, cardNumber: card.card_number, language: card.language });
  assert.equal(parts.language, null);
  assert.equal(parts.set, l.card.setName);
  assert.equal(identityKeyRefusal(parts), null);
  assert.ok(!card.identity_key!.endsWith("|English"));
});

test("renaiss identity: the set code stands in for a missing set name; languages normalise", () => {
  const parts = extractCardIdentity({ platform: "renaiss", name: "Kecleon", cardName: "Kecleon", set: null, setCode: "SV8", grade: "PSA 10", cardNumber: "118", language: "Simplified Chinese" });
  assert.equal(parts.set, "SV8");
  assert.equal(parts.language, "Chinese");
  assert.equal(languageOfField("English"), null);
  assert.equal(languageOfField("Japanese"), "Japanese");
  assert.equal(languageOfField(null), null);
});

test("the quirk is Renaiss-only: other platforms read language off the name as before", () => {
  const row = { name: "2023 Scarlet ex Klawf #88 CGC 10", cardName: "Klawf", set: "Scarlet ex", grade: "CGC 10", year: 2023, cardNumber: "88" };
  const before = extractCardIdentity(row);
  assert.deepEqual(extractCardIdentity({ ...row, platform: "beezie", language: "Japanese", setCode: "SV1S" }), before);
  assert.equal(before.language, null);
});

// ── Cursor and `from` overlap ───────────────────────────────────────────────

test("paging sends `from` on the first request only, then each nextCursor as `after`", async () => {
  const asked: FeedQuery[] = [];
  const pages = [
    { rows: [1, 2], nextCursor: "c1", hasMore: true, rate: null },
    { rows: [3], nextCursor: "c2", hasMore: true, rate: null },
    { rows: [], nextCursor: "c2", hasMore: false, rate: null },
  ];
  const seen: number[] = [];
  const run = await pageFeed<number>({
    fetchPage: async (q) => {
      asked.push(q);
      return pages[asked.length - 1];
    },
    from: "2026-09-29T00:00:00.000Z",
    onPage: (rows) => void seen.push(...rows),
  });
  assert.deepEqual(asked, [
    { from: "2026-09-29T00:00:00.000Z", limit: 500 },
    { after: "c1", limit: 500 },
    { after: "c2", limit: 500 },
  ]);
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(run.stoppedBy, "caught-up");
  assert.equal(run.lastCursor, "c2");
});

test("incremental starts overlap the store, and the overlap re-maps to identical rows", () => {
  const newest = salesWeek[salesWeek.length - 1].soldAt; // 2026-09-30T01:51:18Z
  assert.equal(salesIncrementalFrom(newest), "2026-09-29T01:51:18.000Z");
  assert.equal(salesIncrementalFrom(null), null);
  // Pulls: the earlier of (newest − 1 day) and (now − 14 days).
  const now = Date.parse("2026-09-30T06:00:00Z");
  assert.equal(pullsIncrementalFrom("2026-09-30T05:00:00Z", now), "2026-09-16T06:00:00.000Z");
  assert.equal(pullsIncrementalFrom("2026-06-01T00:00:00Z", now), "2026-05-31T00:00:00.000Z");
  assert.equal(pullsIncrementalFrom(null, now), null);

  // Run 1 stores the week; run 2 re-reads from its incremental start.
  const store = new Map(salesWeek.map((s) => [toStoredSale(s).sale_id, toStoredSale(s)]));
  const from = Date.parse(salesIncrementalFrom(newest)!);
  const reread = salesWeek.filter((s) => Date.parse(s.soldAt) >= from);
  assert.ok(reread.length > 0);
  for (const s of reread) {
    const row = toStoredSale(s);
    assert.deepEqual(store.get(row.sale_id), row); // same key, same row: the upsert is a no-op
    store.set(row.sale_id, row);
  }
  assert.equal(store.size, salesWeek.length);
});

test("stored rows become the shared sale shape, priced rows only", () => {
  const rows = [...salesOldest, constructed.unlinkedSale].map(toStoredSale);
  const sales = toNormalizedSales([...rows, { ...rows[0], sale_id: "x:1", price_usd: null }]);
  assert.equal(sales.length, rows.length);
  assert.deepEqual(sales[0], { date: "2026-01-09T04:08:04.000Z", tokenId: salesOldest[0].tokenId, buyer: rows[0].buyer, seller: rows[0].seller, priceUsd: 30.6 });
});

// ── Budget guards ───────────────────────────────────────────────────────────

test("no key, no run: one line, exit 0, no request", async () => {
  let fetched = 0;
  resetRenaissClient({ fetch: async () => (fetched++, new Response("{}")), sleep: noSleep });
  for (const env of [{}, { RENAISS_API_KEY: "rk_only" }, { RENAISS_API_SECRET: "rsk_only" }]) {
    for (const feed of ["sales", "pulls"] as const) {
      const lines: string[] = [];
      assert.equal(await runRenaissWarmer(feed, ["--apply", "--backfill"], { env, log: (l) => lines.push(l) }), 0);
      assert.deepEqual(lines, [NO_KEY_LINE]);
    }
  }
  assert.equal(fetched, 0);
  assert.equal(renaissCredentials(KEYS)?.key, "rk_test");
  assert.equal(noKeyExit(KEYS, () => assert.fail("logged with a key")), false);
  await assert.rejects(renaissGet("/renaiss/sales", {}, { env: {} }), /not both set/);
});

/** A transport whose every page says there is more. */
function endlessFeed(counter: { n: number }) {
  return async () => {
    counter.n++;
    return new Response(JSON.stringify({ sales: [salesWeek[counter.n % salesWeek.length]], nextCursor: `c${counter.n}`, hasMore: true }), {
      headers: { "x-ratelimit-limit": "10000", "x-ratelimit-remaining": String(10_000 - counter.n) },
    });
  };
}

test("the call ceiling stops a run and fails it after the pages it got", async () => {
  const counter = { n: 0 };
  resetRenaissClient({ fetch: endlessFeed(counter), sleep: noSleep });
  const lines: string[] = [];
  await assert.rejects(
    runRenaissWarmer("sales", ["--backfill", "--dry-run"], { env: { ...KEYS, RENAISS_MAX_CALLS: "3" }, log: (l) => lines.push(l) }),
    /ceiling of 3 requests/,
  );
  assert.equal(counter.n, 3);
  assert.equal(renaissCallCount(), 3);
  assert.equal(lines.filter((l) => /^\s+page\s+\d+ ·/.test(l)).length, 3);
  assert.ok(lines.some((l) => /X-RateLimit-Remaining 9997/.test(l)), "the remaining quota is logged per page");
});

test("the ceiling defaults to 1,500 per run", async () => {
  const counter = { n: 0 };
  resetRenaissClient({ fetch: endlessFeed(counter), sleep: noSleep });
  const run = await pageFeed({
    fetchPage: (q) => renaissGet<{ sales: RenaissSaleRow[]; nextCursor: string; hasMore: boolean }>("/renaiss/sales", { after: q.after, limit: q.limit }, { env: KEYS }).then(({ body, rate }) => ({ rows: body.sales, nextCursor: body.nextCursor, hasMore: body.hasMore, rate })),
    onPage: () => {},
  });
  assert.equal(run.stoppedBy, "ceiling");
  assert.equal(counter.n, 1_500);
});

test("a 429 honours Retry-After once, then stops; a long wait stops at once", async () => {
  const waits: number[] = [];
  const replies = [429, 200, 429];
  let i = 0;
  resetRenaissClient({
    sleep: async (ms) => void waits.push(ms),
    fetch: async () => {
      const status = replies[i++];
      return status === 429
        ? new Response("{}", { status, headers: { "retry-after": "2", "x-ratelimit-remaining": "0" } })
        : new Response(JSON.stringify({ sales: [], nextCursor: "c", hasMore: true }));
    },
  });
  const run = await pageFeed({
    fetchPage: (q) => renaissGet<{ sales: RenaissSaleRow[]; nextCursor: string; hasMore: boolean }>("/renaiss/sales", { after: q.after }, { env: KEYS }).then(({ body, rate }) => ({ rows: body.sales, nextCursor: body.nextCursor, hasMore: body.hasMore, rate })),
    onPage: () => {},
  });
  assert.equal(run.stoppedBy, "rate-limited");
  assert.equal(run.pages, 1);
  assert.deepEqual(waits.filter((ms) => ms >= 1000), [2000]);

  resetRenaissClient({
    sleep: async (ms) => void waits.push(ms),
    fetch: async () => new Response("{}", { status: 429, headers: { "retry-after": "3600" } }),
  });
  waits.length = 0;
  await assert.rejects(renaissGet("/renaiss/sales", {}, { env: KEYS }), /Retry-After 3600s/);
  assert.deepEqual(waits.filter((ms) => ms >= 1000), []);
  assert.equal(retryAfterSeconds("Wed, 30 Sep 2026 00:01:00 GMT", Date.parse("2026-09-30T00:00:00Z")), 60);
});

// ── Completeness and currency of the feeds ──────────────────────────────────

test("a day is complete once the newest row is past its end and the run reached the present", () => {
  const now = Date.parse("2026-09-30T06:00:00Z");
  const caught = nextFeedState(undefined, { stoppedBy: "caught-up", newestRowAt: "2026-09-30T01:51:18.000Z" }, now);
  assert.equal(lastCompleteDay(caught), "2026-09-29T00:00:00.000Z");
  // A run that stopped short publishes nothing new, and keeps when it last caught up.
  const stopped = nextFeedState(caught, { stoppedBy: "ceiling", newestRowAt: "2026-09-30T01:51:18.000Z" }, now + 3_600_000);
  assert.equal(lastCompleteDay(stopped), null);
  assert.equal(stopped.caughtUpAt, caught.caughtUpAt);
  assert.equal(feedIsCurrent(stopped, now + 3_600_000), true);
  assert.equal(feedIsCurrent(stopped, now + 13 * 3_600_000), false);
  assert.equal(feedIsCurrent(undefined, now), false);
});

// ── The dry run end to end, on the fixtures ─────────────────────────────────

test("a fixture dry run maps both feeds and writes nothing", async () => {
  for (const [feed, files, expect] of [
    ["sales", ["sales-oldest.json", "sales-week.json"], /Would write 49 sales rows/],
    ["pulls", ["pulls-oldest.json", "pulls-week.json"], /Would write 503 pack pulls rows/],
  ] as const) {
    const lines: string[] = [];
    const code = await runRenaissWarmer(feed, ["--dry-run", "--limit", "3", `--fixture=${files.map((f) => join(FIX, f)).join(",")}`], {
      env: {},
      log: (l) => lines.push(l),
    });
    assert.equal(code, 0);
    assert.ok(lines.some((l) => expect.test(l)), lines.join("\n"));
    assert.ok(lines.some((l) => /Dune 0 calls, 0 datapoints/.test(l)));
  }
  assert.equal(renaissCallCount(), 0);
});

test("--fixture refuses --apply", async () => {
  const lines: string[] = [];
  assert.equal(await runRenaissWarmer("sales", ["--apply", `--fixture=${join(FIX, "sales-week.json")}`], { env: KEYS, log: (l) => lines.push(l) }), 1);
  assert.match(lines[0], /dry run only/);
});
