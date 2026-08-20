/**
 * Heal the time-series spine — the whole runbook, in one command.
 *
 *     npm run heal-spine
 *
 * Runs, in order and only in this order:
 *
 *   1. warm-metric-snapshots   rewrites the trailing 35 days of the spine
 *   2. warm-homepage           re-derives the payload FROM that spine
 *   3. check-invariants        gates payload against spine
 *
 * ⚠️ THE ORDER IS THE POINT. `check-invariants` does not read the spine alone —
 * INV-3 (column semantics), INV-6 (hero == Σ platform rows) and INV-8 (Σ 24h
 * deltas gated to source-complete days) all compare the stored HOMEPAGE PAYLOAD
 * against figures re-derived live. Step 1 moves the spine, so a payload written
 * before it is stale by construction, and the gate then fails describing a
 * completeness regression that never happened. That is exactly the 06:00 false
 * positive seen on 2026-08-19 and 2026-08-20.
 *
 * Running step 1 by hand and stopping — which is what everyone did, because it is
 * the step that fixes the data — leaves the payload behind and hands the next
 * scheduled gate a guaranteed false alarm. This wrapper exists so that is not a
 * thing anyone can forget: there is no flag to skip the trailing steps.
 *
 * ⚠️ A FAILED STEP 2 ABORTS BEFORE STEP 3. A stale payload plus a fresh spine is
 * the precise condition INV-8 misreports, so gating on it would produce the wrong
 * diagnosis. Better to say "the payload never got written" than to let the gate
 * blame the completeness logic.
 *
 * Step 3 failing is NOT an error in this script — it is the finding. Its exit
 * code is propagated so CI and a human see the same red.
 */
import { spawnSync } from "node:child_process";

type Step = {
  label: string;
  script: string;
  /** What a non-zero exit means, and whether the run can continue past it. */
  fatal: string | null;
  /** Forward this command's own CLI args to the step. Only the gate parses any
   *  (`--strict`); the two warmers read no argv at all, so handing them an
   *  unknown flag would only be a way to get a confusing failure later. */
  forwardArgs?: true;
};

const STEPS: Step[] = [
  {
    label: "1/3  metric snapshots — rewrite the trailing 35d of the spine",
    script: "scripts/warm-metric-snapshots.ts",
    fatal: "the spine was not rewritten, so there is nothing to re-derive from",
  },
  {
    label: "2/3  homepage payload — re-derive from the spine just written",
    script: "scripts/warm-homepage.ts",
    fatal:
      "the payload is now OLDER than the spine. Running the invariants gate on that " +
      "combination reports a completeness regression that did not happen (INV-8), so " +
      "it is skipped. Fix the payload writer, then re-run this command",
  },
  {
    label: "3/3  invariants gate — payload vs spine",
    script: "scripts/check-invariants.ts",
    fatal: null, // a failure here is a real finding; propagate, don't reframe
    forwardArgs: true, // `npm run heal-spine -- --strict`
  },
];

function run(step: Step): number {
  console.log(`\n── ${step.label} ──`);
  const args = step.forwardArgs ? process.argv.slice(2) : [];
  const res = spawnSync("npx", ["tsx", step.script, ...args], {
    stdio: "inherit",
    // Inherit the parent env: these scripts read SUPABASE_* / DUNE_API_KEY from
    // .env.local themselves, exactly as they do under Actions.
    env: process.env,
  });
  if (res.error) {
    console.error(`\n✗ could not start ${step.script}: ${res.error.message}`);
    return 1;
  }
  // A signalled death (OOM, Ctrl-C) has a null status — treat it as failure, not 0.
  return res.status ?? 1;
}

function main(): void {
  console.log("heal-spine — metric-snapshots → warm-homepage → check-invariants");

  for (const step of STEPS) {
    const code = run(step);
    if (code === 0) continue;

    if (step.fatal === null) {
      // The gate spoke. Its exit code is the answer.
      console.error(`\n✗ invariants gate failed (exit ${code}). That is a real finding — see above.`);
      process.exit(code);
    }
    console.error(`\n✗ ABORTED at "${step.label}" (exit ${code})\n  ${step.fatal}.`);
    process.exit(code);
  }

  console.log("\n✓ spine healed — payload re-derived and invariants pass.");
}

main();
