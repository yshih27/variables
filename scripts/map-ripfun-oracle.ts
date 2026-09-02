/**
 * CardOS oracle — the MAPPING pass. Run on demand, not on a schedule.
 *
 *   npm run map-ripfun-oracle -- --plan            # 0 credits: what it would walk
 *   npm run map-ripfun-oracle                      # the real pass (~65 credits)
 *   npm run map-ripfun-oracle -- --max-credits 30  # a smaller bite
 *   npm run map-ripfun-oracle -- --force           # re-walk expansions already mapped
 *
 * WHAT IT DOES, AND WHY IT IS SHAPED THIS WAY:
 * CardOS holds ~37K Pokémon printings and walking all of them is 474 credits —
 * the entire monthly allowance, for one pass. What we need comps for is the few
 * hundred printings OUR platforms actually trade, and those cluster into a few
 * dozen sets. So the pass ranks our own 30d sales by printing, resolves their set
 * strings to CardOS expansions, and walks only the expansions the budget buys,
 * most-traded first. One page (1 credit) maps up to 100 printings and carries
 * their prices for free.
 *
 * ⚠️ NEVER `q=name:…`. A name lookup is 1 credit PER CARD; at ~500 traded types
 * that is the whole month to map one month's inventory once. The per-expansion
 * walk exists precisely to avoid it, and nothing here should ever reintroduce it.
 *
 * Halting is safe at any point: both stores merge rather than replace, the
 * monthly meter is charged per page, and the next run re-plans from what is
 * already mapped.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { rankTradedPrintings } from "../src/lib/ripfun/demand";
import { fetchExpansionIndexes, EXPANSION_INDEX_PAGES } from "../src/lib/ripfun/index";
import { planExpansions, walkExpansionCards, matchPrintings, toStoredPrinting } from "../src/lib/ripfun/pass";
import { mergeOracleMap, mergeOraclePrices, mappedCardosIds, readOraclePrices, type PrintingMapping, type StoredPrinting } from "../src/lib/ripfun/oracleStore";
import { assertMonthlyBudget, chargeMonthly, meterLine, readMonthlyMeter } from "../src/lib/ripfun/meter";
import { ripFunSpend, setRunCreditBudget } from "../src/lib/ripfun/client";

const SOURCE = "ripfun-oracle-map";
const argv = process.argv;
const planOnly = argv.includes("--plan");
const force = argv.includes("--force");

function numArg(flag: string, dflt: number): number {
  const i = argv.indexOf(flag);
  if (i < 0) return dflt;
  const n = Number(argv[i + 1]);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`${flag} requires a positive number, got: ${argv[i + 1] ?? "(nothing)"}`);
    process.exit(1);
  }
  return n;
}

const MAX_WALK_CREDITS = numArg("--max-credits", 65);
const DEMAND_DAYS = numArg("--days", 30);

async function main() {
  console.log(`CardOS oracle mapping pass — ranking OUR ${DEMAND_DAYS}d traded printings first.\n`);

  const ranking = await rankTradedPrintings({ days: DEMAND_DAYS });
  console.log(
    `Demand: ${ranking.printings.length} distinct printings · ${ranking.totalTrades} trades\n` +
      `  skipped: ${ranking.skipped.noCard} sale(s) with no cards row · ` +
      `${ranking.skipped.noIdentity} with no usable name+number (these get no comp, by design)`,
  );

  // Declare the WORST case up front: both index walks plus every page of the plan.
  // Under-declaring would make the gate decoration — the pass would start and
  // spend past the budget, with the meter only recording the overrun afterwards.
  const planned = EXPANSION_INDEX_PAGES * 2 + MAX_WALK_CREDITS;
  if (!planOnly) {
    const check = await assertMonthlyBudget(SOURCE, planned, Date.now());
    // The SAME number governs the per-run guard. The client's default ceiling is
    // 50, which silently contradicts a 77-credit plan — and did: the first real
    // run died at credit 51, nine expansions deep, having already spent them.
    setRunCreditBudget(planned);
    console.log(`\nBudget: ${meterLine(check.meter, check.budget)} · this pass declares ≤${planned}\n`);
  }

  // --plan still needs the index to say anything useful, and the index is the
  // cheap half. It is charged like any other call.
  const indexes = await fetchExpansionIndexes(SOURCE, ["pokemon", "onepiece"], (m) => console.log(m));

  // RESUME BY DEFAULT. A halted pass is the normal case here — the budget gate
  // exists to stop runs mid-way — so a re-run picks up the tail instead of
  // re-buying the head. `--force` re-walks everything.
  const RESUME_DAYS = 7;
  const stored = await readOraclePrices();
  const freshEnough = (id: string) => {
    if (force) return false;
    const at = stored?.refreshedAt?.[id];
    if (!at) return false;
    const age = Date.now() - Date.parse(at);
    return Number.isFinite(age) && age < RESUME_DAYS * 86_400_000;
  };
  const plan = planExpansions(ranking.printings, indexes, {
    maxCredits: MAX_WALK_CREDITS,
    skip: freshEnough,
  });
  const resolvedTrades = plan.chosen.reduce((s, e) => s + e.trades, 0);
  const deferredTrades = plan.deferred.reduce((s, e) => s + e.trades, 0);
  const unresolvedTrades = plan.unresolvedSets.reduce((s, e) => s + e.trades, 0);

  console.log(`\nPlan — ${plan.chosen.length} expansion(s), ${plan.credits} credit(s):`);
  for (const e of plan.chosen) {
    console.log(
      `  ${String(e.trades).padStart(4)} trades · ${String(e.pages).padStart(2)}cr · ` +
        `${e.expansionId.padEnd(16)} ${e.lang} "${e.name}" ← ${e.setRaws.slice(0, 2).join(" / ").slice(0, 52)}`,
    );
  }
  console.log(
    `\nCoverage of ${ranking.totalTrades} traded: ${resolvedTrades} in plan · ${deferredTrades} deferred (budget) · ` +
      `${unresolvedTrades} unresolved set · ${plan.outOfScope} out of scope (no CardOS game for the IP)`,
  );
  if (plan.alreadyMapped.length) {
    const cr = plan.alreadyMapped.reduce((s, e) => s + e.pages, 0);
    console.log(
      `\nAlready mapped within ${RESUME_DAYS}d — skipped, saving ~${cr} credit(s): ` +
        plan.alreadyMapped.slice(0, 8).map((e) => e.expansionId).join(", ") +
        (plan.alreadyMapped.length > 8 ? ` +${plan.alreadyMapped.length - 8} more` : "") +
        ` (--force to re-walk)`,
    );
  }
  if (plan.deferred.length) {
    console.log(`\nDeferred — resolved, not bought this run (raise --max-credits or run again next month):`);
    for (const d of plan.deferred.slice(0, 10)) console.log(`  ${String(d.trades).padStart(4)} trades · ${d.pages}cr · ${d.expansionId} "${d.name}"`);
  }
  console.log(`\nTop unresolved set strings (these printings get NO comp — honest absence):`);
  for (const u of plan.unresolvedSets.slice(0, 12)) {
    console.log(`  ${String(u.trades).padStart(4)} trades · [${u.ip}/${u.lang}] ${JSON.stringify(u.setRaw).slice(0, 60)}`);
  }

  if (planOnly) {
    console.log(`\n(--plan: no expansion walked. Index cost ${ripFunSpend().credits} credit(s).)`);
    console.log(meterLine(await readMonthlyMeter()));
    return;
  }

  console.log(`\nWalking ${plan.chosen.length} expansion(s)…`);
  const mapping: Record<string, PrintingMapping> = {};
  const unmatched: string[] = [];
  const prices: StoredPrinting[] = [];
  const bySignal = { "number+name": 0, number: 0, name: 0 };
  const fetchedAt = new Date().toISOString();
  const walked: typeof plan.chosen = [];

  for (const e of plan.chosen) {
    const walk = await walkExpansionCards(SOURCE, e.game, e.expansionId, { log: (m) => console.log(m) });
    const res = matchPrintings(e.game, e.expansionId, walk.cards, e.members);
    Object.assign(mapping, res.mapping);
    unmatched.push(...res.unmatched);
    for (const k of ["number+name", "number", "name"] as const) bySignal[k] += res.bySignal[k];
    for (const c of walk.cards) {
      const row = toStoredPrinting(c, e.expansionId, fetchedAt);
      if (row) prices.push(row);
    }
    walked.push({ ...e, pages: walk.pages });

    // ⚠️ PERSIST PER EXPANSION, NOT ONCE AT THE END. The first real run proved
    // why: it halted on a budget guard after nine expansions, and because the
    // merge came after the loop, ~41 credits of correct mapping work evaporated
    // while the credits stayed spent. Both stores merge rather than replace, so
    // writing each expansion as it lands is idempotent and a halt keeps
    // everything already bought.
    // `members` is the matcher's input, not part of the stored record — build the
    // stored shape explicitly rather than destructuring it away.
    const meta = {
      game: e.game,
      expansionId: e.expansionId,
      name: e.name,
      lang: e.lang,
      setRaws: e.setRaws,
      trades: e.trades,
      cards: e.cards,
      pages: walk.pages,
    };
    const merged = await mergeOracleMap({ expansions: [meta], printings: res.mapping, unmatched: res.unmatched });
    // Only the cards the MAP references are stored. A walk returns every printing
    // in the expansion (350-600 of them) and we map a few dozen; keeping the rest
    // grew this snapshot to 9.1 MB before the prune existed.
    const keep = mappedCardosIds(merged);
    await mergeOraclePrices({
      printings: walk.cards
        .map((c) => toStoredPrinting(c, e.expansionId, fetchedAt))
        .filter((r): r is StoredPrinting => r !== null && keep.has(r.cardosId)),
      refreshedExpansions: [e.expansionId],
      keep,
    });

    const hit = e.members.length ? ((Object.keys(res.mapping).length / e.members.length) * 100).toFixed(0) : "—";
    console.log(
      `  ${e.expansionId.padEnd(16)} ${walk.cards.length} cards / ${walk.pages}cr · ` +
        `matched ${Object.keys(res.mapping).length}/${e.members.length} printings (${hit}%) · stored`,
    );
  }

  const candidates = plan.chosen.reduce((s, e) => s + e.members.length, 0);
  const matched = Object.keys(mapping).length;
  const hitRate = candidates ? (matched / candidates) * 100 : 0;

  console.log(`\n── Result ──`);
  console.log(`  printings matched   ${matched}/${candidates}  (${hitRate.toFixed(1)}% hit-rate)`);
  console.log(`    by number+name    ${bySignal["number+name"]}`);
  console.log(`    by number only    ${bySignal.number}`);
  console.log(`    by unique name    ${bySignal.name}`);
  console.log(`  unmatched (no comp) ${unmatched.length}`);
  console.log(`  comps stored        ${prices.length} CardOS printings`);
  const spend = ripFunSpend();
  console.log(`  run spend           ${spend.credits} credit(s) · account reports ${spend.remaining ?? "?"} remaining`);
  console.log(`  ${meterLine(await readMonthlyMeter())}`);

  // The brief's own stop rule: below ~60% the matcher is wrong about something
  // structural, and the answer is to look at the patterns, not to spend more.
  if (candidates > 0 && hitRate < 60) {
    console.log(
      `\n⚠ HIT-RATE BELOW 60% — stopping short of further passes on purpose. Inspect the\n` +
        `  unmatched patterns before spending more credits; the failure is structural, and\n` +
        `  retrying the same matcher just buys the same misses again.`,
    );
  }
}

main().catch(async (e) => {
  console.error(e);
  // A crash has still spent whatever it spent. Say so, so the next run is planned
  // against reality rather than against the meter's last clean reading.
  await chargeMonthly(SOURCE, 0).catch(() => {});
  console.error(`(${meterLine(await readMonthlyMeter().catch(() => ({ month: "?", credits: 0, bySource: {}, updatedAt: "" })))})`);
  process.exit(1);
});
