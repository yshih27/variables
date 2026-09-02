/**
 * CardOS MONTHLY credit meter.
 *
 * The client's `RIP_CREDIT_BUDGET` guard is per-RUN: it stops one runaway walk.
 * It cannot see that eight well-behaved runs have between them eaten the month.
 * CardOS bills 1 credit per call against a 500/month allowance that resets on the
 * calendar month, and when it hits zero every request returns 402 until someone
 * tops up — so the failure mode is the whole oracle going dark, not one bad run.
 *
 * This is the Helius/Dune meter pattern (see runWarmer's recordHeliusCredits /
 * recordDuneSpend) with the one difference that matters: those record spend for
 * later reading, and this one REFUSES A PASS UP FRONT. A pass declares what it
 * intends to spend; if month-to-date + that plan would cross RIP_MONTHLY_BUDGET
 * the pass does not start. Refusing before the first call is the only point at
 * which refusing is free.
 *
 * ⚠️ PERSIST AS YOU GO, NOT AT THE END. A pass that dies at credit 40 of 60 has
 * still spent 40. Recording only on success would leave the meter reading zero
 * for spend that already happened — and the next run would then be authorised
 * against a balance that no longer exists. `chargeMonthly` is called per
 * expansion, so a crash loses at most one expansion's worth of count.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";

const SNAPSHOT_KEY = "ripfun-credits";

/**
 * Default 400 against CardOS's 500. The 100-credit headroom is deliberate: the
 * meter counts what WE know we spent, and it cannot see a call made from another
 * key on the same account, a run that died before it could persist, or a manual
 * preflight. Budgeting to the true ceiling would make the first surprise a 402.
 */
const DEFAULT_MONTHLY_BUDGET = 400;

export function monthlyBudget(): number {
  const raw = Number(process.env.RIP_MONTHLY_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MONTHLY_BUDGET;
}

/** UTC calendar month, "2026-09" — CardOS resets monthly, and UTC is the one
 *  clock a cron in Actions and a laptop in +08 can agree on. */
export function currentMonth(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 7);
}

export type RipFunMeter = {
  /** The month these counts belong to. A different month means start from zero. */
  month: string;
  /** Month-to-date credits we know we spent. */
  credits: number;
  /** Per-source split, so a runaway is attributable rather than just visible. */
  bySource: Record<string, number>;
  updatedAt: string;
};

function emptyMeter(month: string): RipFunMeter {
  return { month, credits: 0, bySource: {}, updatedAt: new Date().toISOString() };
}

/**
 * Month-to-date spend. A stored meter from a PREVIOUS month reads as zero rather
 * than being carried forward — the allowance reset, so the count must too. The
 * old row is left alone until the next write overwrites it.
 */
export async function readMonthlyMeter(now: number = Date.now()): Promise<RipFunMeter> {
  const month = currentMonth(now);
  const stored = await readSnapshot<RipFunMeter>(SNAPSHOT_KEY).catch(() => null);
  if (!stored || stored.month !== month) return emptyMeter(month);
  return {
    month,
    credits: Number.isFinite(stored.credits) ? stored.credits : 0,
    bySource: stored.bySource ?? {},
    updatedAt: stored.updatedAt ?? new Date().toISOString(),
  };
}

/** Add `credits` to this month's count for `source` and persist. */
export async function chargeMonthly(source: string, credits: number, now: number = Date.now()): Promise<RipFunMeter> {
  if (!(credits > 0)) return readMonthlyMeter(now);
  const meter = await readMonthlyMeter(now);
  meter.credits += credits;
  meter.bySource[source] = (meter.bySource[source] ?? 0) + credits;
  meter.updatedAt = new Date(now).toISOString();
  await writeSnapshot(SNAPSHOT_KEY, meter, meter.updatedAt);
  return meter;
}

export class MonthlyBudgetError extends Error {}

export type BudgetCheck = {
  meter: RipFunMeter;
  budget: number;
  remaining: number;
  /** What the caller said it intends to spend. */
  planned: number;
};

/**
 * Gate a pass before its first call. Throws when month-to-date + `planned` would
 * cross the budget.
 *
 * ⚠️ THE PLAN IS AN UPPER BOUND, NOT AN ESTIMATE. A caller that under-declares
 * turns this into decoration: the pass starts, spends past the budget, and the
 * meter only records the overrun afterwards. Declare the worst case (every page
 * of every expansion), and let the pass come in under it.
 */
export async function assertMonthlyBudget(
  source: string,
  planned: number,
  now: number = Date.now(),
): Promise<BudgetCheck> {
  const meter = await readMonthlyMeter(now);
  const budget = monthlyBudget();
  const remaining = budget - meter.credits;
  if (planned > remaining) {
    throw new MonthlyBudgetError(
      `CardOS monthly budget would be exceeded: "${source}" plans ${planned} credit(s), ` +
        `but ${meter.month} is at ${meter.credits}/${budget} (${remaining} left). ` +
        `Narrow the pass (fewer expansions), wait for the month to roll over, or raise ` +
        `RIP_MONTHLY_BUDGET deliberately — CardOS's own free allowance is 500/month and ` +
        `returns 402 once the balance is gone.`,
    );
  }
  return { meter, budget, remaining, planned };
}

/** One-line meter state for a warmer log. */
export function meterLine(meter: RipFunMeter, budget = monthlyBudget()): string {
  const bySource = Object.entries(meter.bySource)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s} ${n}`)
    .join(" · ");
  return `month-to-date ${meter.credits}/${budget} credits (${meter.month})${bySource ? ` — ${bySource}` : ""}`;
}
