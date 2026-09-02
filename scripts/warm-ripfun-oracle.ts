/**
 * CardOS oracle refresh — the weekly half-and-half pass.
 *
 *   npm run warm-ripfun-oracle                 # refresh the oldest quarter + due ladders
 *   npm run warm-ripfun-oracle -- --plan       # 0 credits: what it would refresh
 *   npm run warm-ripfun-oracle -- --no-ladders # prices only
 *
 * CADENCE, AND WHY THIS SHAPE:
 * Comps move on CardOS's own recompute schedule — hours, per their guidance — but
 * we are not paying to chase that. The credit arithmetic IS the design:
 *
 *   mapped expansions        31, measured 121 pages = 121 credits for one full walk
 *   refresh a QUARTER/week   ~30 credits/week × 4.3 weeks   ≈ 130/month
 *   graded ladders           ≤30 per run, self-paced to ~monthly ≈  30/month
 *   ────────────────────────────────────────────────────────────────────────
 *   steady state             ≈ 160/month against a 500/month allowance
 *
 * ⚠️ A QUARTER, NOT A HALF — and the difference is a measurement, not a
 * preference. A half looks right until you price it: an expansion's `total` is
 * its PRINTED set size, while its card list carries every art and finish variant,
 * so the real walk is ~1.8× what the index implies. Half of 31 expansions is ~60
 * credits a week — 260/month, most of the allowance, for a number that is context
 * rather than a live figure. A quarter re-prices every expansion MONTHLY at a
 * third of that.
 *
 * "Which quarter" is decided by which expansions have gone longest without a
 * refresh, so a run that halts early resumes on the sets it starved rather than
 * walking the same head every week.
 *
 * ⚠️ NOT IN THE HEALTH GATE'S `--require` LIST. This warmer is designed to stop
 * early when the month's credits run low, and stopping early is CORRECT
 * behaviour, not an outage. Paging someone because a budget guard did its job is
 * how a gate gets muted. It records freshness like every other source, so
 * check-freshness still SHOWS it — it just does not fail the run.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { runWarmer } from "../src/lib/db/runWarmer";
import { ripFunSpend, setRunCreditBudget } from "../src/lib/ripfun/client";
import { assertMonthlyBudget, meterLine, readMonthlyMeter, MonthlyBudgetError } from "../src/lib/ripfun/meter";
import { walkExpansionCards, toStoredPrinting, pagesFor } from "../src/lib/ripfun/pass";
import { fetchCardPrices } from "../src/lib/ripfun/catalog";
import { chargeMonthly } from "../src/lib/ripfun/meter";
import { parseMoney } from "../src/lib/ripfun/oracle";
import {
  readOracleMap,
  readOraclePrices,
  mergeOraclePrices,
  mappedCardosIds,
  type StoredPrinting,
} from "../src/lib/ripfun/oracleStore";

const SOURCE = "ripfun-oracle";
const argv = process.argv;
const planOnly = argv.includes("--plan");
const noLadders = argv.includes("--no-ladders");

/** Ladders self-pace: a card whose detail is younger than this is left alone, so
 *  the step costs ~30 credits a MONTH however often the warmer runs. */
const LADDER_MAX_AGE_MS = 25 * 86_400_000;
const LADDER_CAP = 30;

function numArg(flag: string, dflt: number): number {
  const i = argv.indexOf(flag);
  if (i < 0) return dflt;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}
/** 4 = a quarter of the mapped expansions per run. See the cadence note above. */
const FRACTION_DIVISOR = numArg("--fraction", 4);

async function run() {
  const map = await readOracleMap();
  if (!map?.expansions?.length) {
    // Not an error: the oracle simply has not been mapped yet. Saying so beats
    // an empty "0 rows" that reads like a dead feed.
    console.log(`No oracle map yet — run \`npm run map-ripfun-oracle\` first. Nothing to refresh.`);
    return { rowsWritten: 0 };
  }

  const prices = await readOraclePrices();
  // Oldest-refreshed first, so a halted run resumes on the sets it starved.
  const due = [...map.expansions].sort((a, b) => {
    const ta = Date.parse(prices?.refreshedAt?.[a.expansionId] ?? "1970-01-01");
    const tb = Date.parse(prices?.refreshedAt?.[b.expansionId] ?? "1970-01-01");
    return ta - tb;
  });
  const slice = due.slice(0, Math.max(1, Math.ceil(due.length / FRACTION_DIVISOR)));

  // Ladder candidates: mapped cards whose richer /prices detail is stale, most
  // graded-evidence first so the 30 we buy are the ones a reader will look at.
  const ladderIds = noLadders
    ? []
    : Object.values(prices?.byCardosId ?? {})
        .filter((r) => r.graded?.length)
        .filter((r) => {
          const at = r.laddersAt ? Date.parse(r.laddersAt) : NaN;
          return !Number.isFinite(at) || Date.now() - at > LADDER_MAX_AGE_MS;
        })
        .sort((a, b) => {
          const sold = (r: StoredPrinting) => (r.graded ?? []).reduce((s, g) => s + (g.soldCount ?? 0), 0);
          return sold(b) - sold(a);
        })
        .slice(0, LADDER_CAP)
        .map((r) => r.cardosId);

  const walkCredits = slice.reduce((s, e) => s + pagesFor(e.cards || 0) * 2, 0);
  const planned = walkCredits + ladderIds.length;
  console.log(
    `CardOS oracle refresh — ${slice.length}/${map.expansions.length} expansion(s) ` +
      `(oldest-refreshed first) + ${ladderIds.length} graded ladder(s) · declares ≤${planned} credit(s)`,
  );
  for (const e of slice) {
    const at = prices?.refreshedAt?.[e.expansionId];
    console.log(`  ${e.expansionId.padEnd(16)} ${e.lang} "${e.name}" · last ${at ? at.slice(0, 10) : "never"}`);
  }

  if (planOnly) {
    console.log(`\n(--plan: no calls made.) ${meterLine(await readMonthlyMeter())}`);
    return { rowsWritten: 0 };
  }

  const check = await assertMonthlyBudget(SOURCE, planned);
  setRunCreditBudget(planned);
  console.log(`Budget: ${meterLine(check.meter, check.budget)}\n`);

  const keep = mappedCardosIds(map);
  const fetchedAt = new Date().toISOString();
  let written = 0;
  const refreshed: string[] = [];

  for (const e of slice) {
    try {
      const walk = await walkExpansionCards(SOURCE, e.game, e.expansionId, { log: (m) => console.log(m) });
      const rows = walk.cards
        .map((c) => toStoredPrinting(c, e.expansionId, fetchedAt))
        .filter((r): r is StoredPrinting => r !== null && keep.has(r.cardosId));
      await mergeOraclePrices({ printings: rows, refreshedExpansions: [e.expansionId], keep });
      refreshed.push(e.expansionId);
      written += rows.length;
      console.log(`  ${e.expansionId.padEnd(16)} ${walk.cards.length} cards / ${walk.pages}cr → ${rows.length} comp(s) refreshed`);
    } catch (err) {
      // A budget stop is the design working, not a failure: keep what landed and
      // let the next run continue from the oldest-refreshed end.
      if (err instanceof MonthlyBudgetError || /credit budget exceeded/i.test((err as Error).message)) {
        console.log(`  ⏹ stopping early on the credit guard — ${(err as Error).message.split(".")[0]}`);
        break;
      }
      throw err;
    }
  }

  // ── Graded ladders: the /prices detail, which is the only route carrying the
  //    sold BAND and last_sold_at. One credit per card, so it is capped and
  //    self-paced rather than run over the whole map. ──
  let ladders = 0;
  for (const cardosId of ladderIds) {
    const row = (await readOraclePrices())?.byCardosId?.[cardosId];
    if (!row) continue;
    const exp = map.expansions.find((e) => e.expansionId === row.expansionId);
    if (!exp) continue;
    try {
      const detail = await fetchCardPrices(exp.game, cardosId);
      await chargeMonthly(SOURCE, 1);
      const graded = (detail.pricing?.graded ?? [])
        .map((g) => {
          const value = parseMoney(g.value);
          if (value == null || !g.company || g.grade == null) return null;
          return {
            company: String(g.company),
            grade: String(g.grade),
            valueUsd: value,
            basis: g.value_kind ?? null,
            confidence: g.confidence ?? null,
            soldCount: Number.isFinite(g.sold_count as number) ? (g.sold_count as number) : null,
            lastSoldAt: g.last_sold_at ?? null,
            band: g.band
              ? {
                  median: parseMoney(g.band.median),
                  recentMedian: parseMoney(g.band.recent_median),
                  p10: parseMoney(g.band.p10),
                  p90: parseMoney(g.band.p90),
                  count: Number.isFinite(g.band.count as number) ? (g.band.count as number) : null,
                }
              : null,
          };
        })
        .filter((g): g is NonNullable<typeof g> => g !== null);
      if (!graded.length) continue;
      await mergeOraclePrices({
        printings: [{ ...row, graded, laddersAt: new Date().toISOString() }],
        refreshedExpansions: [],
        keep,
      });
      ladders++;
    } catch (err) {
      if (/credit budget exceeded/i.test((err as Error).message)) {
        console.log(`  ⏹ ladder step stopping early on the credit guard`);
        break;
      }
      console.warn(`  ladder ${cardosId} failed: ${(err as Error).message}`);
    }
  }

  const spend = ripFunSpend();
  const finalPrices = await readOraclePrices();
  console.log(
    `\n${refreshed.length} expansion(s) refreshed · ${written} comp(s) written · ${ladders} ladder(s) deepened\n` +
      `run spend ${spend.credits} credit(s) · account reports ${spend.remaining ?? "?"} remaining\n` +
      `${meterLine(await readMonthlyMeter())}\n` +
      `store: ${Object.keys(finalPrices?.byCardosId ?? {}).length} comps · ` +
      `${(JSON.stringify(finalPrices ?? {}).length / 1024).toFixed(0)}KB ` +
      `(⚠️ jsonb upserts through PostgREST have died near 15 MB before — gzip-wrap if this approaches it)`,
  );
  return { rowsWritten: written };
}

const main = planOnly ? run : () => runWarmer(SOURCE, run);
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
