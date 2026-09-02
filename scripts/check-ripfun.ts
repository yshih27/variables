/**
 * CardOS preflight — the FIRST thing to run when RIP_API_KEY lands.
 *
 *   npm run check-ripfun            # bounded probe: 7 calls, 7 credits
 *   npm run check-ripfun -- --plan  # 0 calls — print the sync budget arithmetic only
 *
 * Why a probe and not a warmer: rip.fun's Phase 1 marketplace lane turned out to
 * be underivable from this API (docs/roadmap/ripfun-phase1-findings.md), so
 * there is nothing yet to warm. What there IS to establish, the moment a key
 * exists, is that the client talks to CardOS correctly and that the live
 * catalog totals still match the ones the budget arithmetic was built on. Both
 * are cheap; both are what a scope decision should rest on.
 *
 * The probe is deliberately 7 calls — under 1.5% of the monthly free allowance —
 * one per endpoint family the budget below prices, so no leg of that arithmetic
 * rests on a number nothing re-checked. It
 * writes NOTHING: no snapshot, no source_freshness row. A preflight that
 * advertised a warm would be claiming a data source we do not have.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { ripFunSpend, RIPFUN_PAGE_SIZE } from "../src/lib/ripfun/client";
import {
  fetchCardPrices,
  fetchCardsPage,
  fetchExpansionsPage,
  fetchSealedPage,
  gradedLabel,
  soldBackedGrades,
  RIPFUN_PRICED_GAMES,
  type RipFunGame,
} from "../src/lib/ripfun/catalog";

const planOnly = process.argv.includes("--plan");

/**
 * Totals read from the live API on 2026-09-02 (English). The probe re-reads them
 * and flags drift: the sync budget below is only as good as these, and a set
 * release moves them.
 */
type Totals = { expansions: number; cards: number; sealed: number };

const BASELINE: Record<string, Totals> = {
  pokemon: { expansions: 203, cards: 37_198, sealed: 3_676 },
  onepiece: { expansions: 62, cards: 5_757, sealed: 273 },
};

/** Calls needed to page `n` rows at the 100-row page cap. */
const pagesFor = (n: number) => Math.ceil(n / RIPFUN_PAGE_SIZE);

function printPlan(totals: Record<string, Totals>): void {
  console.log(`\nFull-catalog sync budget (English only, page_size=${RIPFUN_PAGE_SIZE}, 1 credit/call):`);
  let sum = 0;
  for (const [game, t] of Object.entries(totals)) {
    const exp = pagesFor(t.expansions);
    const cards = pagesFor(t.cards);
    const sealed = pagesFor(t.sealed);
    sum += exp + cards + sealed;
    console.log(
      `  ${game.padEnd(9)} expansions ${String(t.expansions).padStart(6)} → ${String(exp).padStart(4)} calls` +
        ` · cards ${String(t.cards).padStart(6)} → ${String(cards).padStart(4)} calls` +
        ` · sealed ${String(t.sealed).padStart(6)} → ${String(sealed).padStart(4)} calls`,
    );
  }
  console.log(`  ${"TOTAL".padEnd(9)} ${sum} credits — ${((sum / 500) * 100).toFixed(1)}% of the 500/month free tier, in ONE pass.`);
  console.log(
    `  ⚠ cards cannot be paged flat: page × page_size ≤ 10,000 caps a flat walk at 10,000 rows,\n` +
      `    so the walk must go per-expansion or cursor on the last id (adds a partial page per set).`,
  );
}

async function probeGame(game: RipFunGame): Promise<Totals> {
  const exp = await fetchExpansionsPage(game, { pageSize: 5 });
  const cards = await fetchCardsPage(game, { pageSize: 5, includePrices: true });
  const sealed = await fetchSealedPage(game, { pageSize: 5 });

  console.log(`\n── ${game} ──`);
  console.log(`  expansions total_count = ${exp.total_count} (page ${exp.page}, language ${exp.language ?? "?"})`);
  console.log(`    e.g. ${exp.data.slice(0, 3).map((e) => `${e.id} "${e.name}" ${e.total} cards`).join(" · ")}`);
  console.log(`  cards      total_count = ${cards.total_count}`);
  for (const c of cards.data.slice(0, 3)) {
    const p = c.pricing;
    const graded = soldBackedGrades(p)
      .map((g) => `${gradedLabel(g)?.label ?? `${g.company} ${g.grade}`} $${g.value} (${g.sold_count} sold)`)
      .join(", ");
    console.log(
      `    ${c.id.padEnd(14)} ${(c.name ?? "").slice(0, 28).padEnd(28)} market=${p?.market ?? "—"} ${p?.currency ?? ""}` +
        ` stale=${p?.is_stale ?? "—"}${graded ? ` · sold-backed: ${graded}` : " · no sold-backed grade"}`,
    );
  }
  console.log(`  sealed     total_count = ${sealed.total_count}`);
  return { expansions: exp.total_count, cards: cards.total_count, sealed: sealed.total_count };
}

async function main() {
  if (planOnly) {
    printPlan(BASELINE);
    console.log(`\n(--plan: no API calls made.)\n`);
    return;
  }

  if (!process.env.RIP_API_KEY) {
    console.error(
      `\nRIP_API_KEY is not set.\n\n` +
        `  CardOS keys are self-serve: sign in at https://api-docs.rip.fun/account with the\n` +
        `  rip.fun account, create a key, and put it in .env.local as RIP_API_KEY=rip_v1_…\n` +
        `  The full key is shown exactly once at creation.\n\n` +
        `  Run \`npm run check-ripfun -- --plan\` to see the sync budget without a key.\n`,
    );
    process.exit(1);
  }

  console.log(`CardOS preflight — bounded probe, 7 calls / 7 credits, writes nothing.`);

  const live: Record<string, Totals> = {};
  for (const game of RIPFUN_PRICED_GAMES) live[game] = await probeGame(game);

  // The dedicated /prices route — the only one carrying `band` + `last_sold_at`.
  // Probed on a real id from the walk above so this can't go stale against a
  // hardcoded card that gets re-slugged.
  const sample = (await fetchCardsPage("pokemon", { pageSize: 1, orderBy: "-raw_price" })).data[0];
  if (sample) {
    const prices = await fetchCardPrices("pokemon", sample.id);
    const graded = prices.pricing.graded ?? [];
    console.log(`\n── /prices detail (${sample.id} "${sample.name}") ──`);
    console.log(`  market ${prices.pricing.market ?? "—"} · updated ${prices.pricing.market_updated_at ?? "—"}`);
    for (const g of graded.slice(0, 4)) {
      console.log(
        `    ${(gradedLabel(g)?.label ?? `${g.company} ${g.grade}`).padEnd(10)} value=${g.value ?? "—"}` +
          ` kind=${g.value_kind ?? "—"} conf=${g.confidence ?? "—"} sold=${g.sold_count ?? 0}` +
          ` last_sold=${g.last_sold_at ?? "—"} band.count=${g.band?.count ?? "—"}`,
      );
    }
    console.log(
      `  ⓘ no individual sold listings here by design — the docs state pricing returns\n` +
        `    "computed numbers and aggregate bands", never per-sale rows. That is what blocks\n` +
        `    the marketplace lane; see docs/roadmap/ripfun-phase1-findings.md.`,
    );
  }

  // Drift against the totals the budget was computed from.
  console.log("");
  for (const [game, t] of Object.entries(live)) {
    const base = BASELINE[game];
    if (!base) continue;
    const moved = (["expansions", "cards", "sealed"] as const)
      .filter((k) => t[k] !== base[k])
      .map((k) => `${k} ${base[k]} → ${t[k]} (${t[k] - base[k] >= 0 ? "+" : ""}${t[k] - base[k]})`);
    if (moved.length) {
      console.log(`⚠ ${game} catalog moved since 2026-09-02: ${moved.join(", ")}. Re-read the budget below.`);
    }
  }
  printPlan(live);

  const spend = ripFunSpend();
  console.log(
    `\nSpend this run: ${spend.credits} credit(s) over ${spend.calls} request(s)` +
      ` · account reports ${spend.remaining ?? "?"} remaining · run budget ${spend.budget}\n`,
  );
}

main().catch((e) => {
  console.error(e);
  const spend = ripFunSpend();
  console.error(`(spent ${spend.credits} credit(s) before failing; ${spend.remaining ?? "?"} reported remaining)`);
  process.exit(1);
});
