import { test } from "node:test";
import assert from "node:assert/strict";
import { inactiveSummary, splitActive } from "./board";
import type { MachineRow } from "@/lib/data/playerAnalytics";

const row = (key: string, spend7dUsd: number): MachineRow => ({ key, name: key, priceUsd: 1, pulls: 1, spendUsd: 1, spend7dUsd, pulls24h: 0 }) as MachineRow;

test("drops and machines idle for 7 days go under inactive; order holds in both", () => {
  const { active, inactive } = splitActive(
    [row("PANDORA 48", 837_360), row("Entei", 66_600), row("Sep 18", 0), row("PANDORA 248", 3_472), row("Retired", 0)],
    new Set(["Entei", "Sep 18"]),
  );
  assert.deepEqual(active.map((r) => r.key), ["PANDORA 48", "PANDORA 248"]);
  assert.deepEqual(inactive.map((i) => [i.row.key, i.reason]), [
    ["Entei", "drop"],
    ["Sep 18", "drop"],
    ["Retired", "idle"],
  ]);
  assert.equal(inactiveSummary(inactive), "2 sold-out drops · 1 with no pulls in 7 days");
});

test("a drop still selling is not in the drop list yet, so it stays active", () => {
  const { active, inactive } = splitActive([row("Selling now", 66_600)], new Set());
  assert.equal(active.length, 1);
  assert.equal(inactive.length, 0);
  assert.equal(inactiveSummary([{ reason: "idle" }]), "1 with no pulls in 7 days");
});
