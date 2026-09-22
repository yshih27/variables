/**
 * BUYBACK ROWS → THE TWO DAILY SERIES. Query 8252735 (dune/buyback-all-platforms
 * .sql) returns two tiers since 2026-09-22:
 *
 *   • per-RECIPIENT rows (`w` = recipient hash) for the trailing 9 days — the
 *     rows the R3 spender test needs (is this recipient a `gacha_pulls.buyer`?),
 *     which is the only reason a per-recipient row exists;
 *   • per-PLATFORM-DAY rows (`w` NULL) for 35 days — gross outflow, one row a
 *     day, for `outflow_gross_usd` and the 30d reconciliation.
 *
 * Before, every recipient row ran 35 days: 68,880 rows, 344,400 datapoints,
 * 2.43 MB per download every other day — 95% of every datapoint this
 * repository read from Dune. The spine is the system of record (upserts by
 * day), so days older than a week never needed re-classifying; they needed
 * one gross number to reconcile against. This fold accepts BOTH shapes: with
 * no gross tier present (the old query still live on Dune) gross is summed
 * from the recipient rows, exactly as before. Pre-R3 rows (`platform`, `day`,
 * `payout_usd`) are still folded gross-of-list with no basis marker.
 *
 * ⚠️ `w` IS sha256(address) hex, first 16 chars — see the SQL header. The
 * spender keys handed in must be hashed the same way (the caller does).
 */
import type { DuneRow } from "@/lib/dune/client";

const DAY = 24 * 60 * 60 * 1000;

export type BuybackFoldOpts = {
  /** platform → set of recipient keys that are known gacha spenders (hashed like `w`). */
  spenders: Map<string, Set<string>>;
  /** Platforms whose spender set is trusted enough to apply R3 (others count every recipient). */
  trusted: Set<string>;
  /** `p` code → platform key. */
  platformByCode: Record<string, string>;
  nowMs: number;
  /** The R3 match-rate floor; below it a platform's classification is refused. */
  minMatchRate?: number;
  dayStartUtc: (ms: number) => string;
};

export type BuybackFold = {
  basis: "r3" | "pre-r3";
  /** platform → day → payout (R3-classified; gross-of-list when unclassifiable or pre-R3). */
  payouts: Map<string, Map<string, number>>;
  /** platform → complete days the recipient tier covers (its partial first day and today excluded). */
  payoutDays: Map<string, Set<string>>;
  /** platform → day → gross outflow (trusted platforms only). Absent for a platform whose classification failed. */
  gross: Map<string, Map<string, number>>;
  /** platform → complete days the gross tier covers. */
  grossDays: Map<string, Set<string>>;
  match: Map<string, { seen: number; hit: number; rate: number }>;
  stats: { recipientRows: number; grossRows: number; legacyRows: number; recipientDays: number; grossFromRecipients: boolean };
  warnings: string[];
};

export type DayReconciliation = {
  /** Days present in BOTH the source and the spine (a day the spine has not written yet is not drift). */
  sharedDays: number;
  /** Shared days at least `settleDays` old — Dune's Solana transfer feed back-fills for a few days, so only these can show a bad write or a genuine restatement. */
  settledDays: number;
  settledSource: number;
  settledStored: number;
  /** |source − stored| / stored over the settled days (0 when nothing is stored). */
  settledDrift: number;
  freshDays: number;
  freshSource: number;
  freshStored: number;
  perDay: { day: string; source: number; stored: number }[];
};

/**
 * Source-vs-spine comparison that only counts what can actually disagree.
 * Measured 2026-09-22 on the first two-tier run: comparing 8 source days
 * against a spine that had 7 of them, with the newest still filling upstream,
 * printed "27.8% drift" for CC and "94.6%" for Phygitals — construction, not a
 * finding. Shared days only; settled days carry the alarm; fresh days are
 * reported as the restatement they are expected to be.
 */
export function reconcileDays(
  source: Map<string, number>,
  stored: Map<string, number>,
  days: Iterable<string>,
  nowMs: number,
  settleDays = 3,
): DayReconciliation {
  const perDay: { day: string; source: number; stored: number }[] = [];
  let settledSource = 0, settledStored = 0, settledDays = 0, freshSource = 0, freshStored = 0, freshDays = 0;
  for (const day of [...new Set(days)].sort()) {
    if (!stored.has(day)) continue;
    const s = source.get(day) ?? 0;
    const t = stored.get(day) ?? 0;
    perDay.push({ day, source: s, stored: t });
    if (Date.parse(day) + settleDays * DAY <= nowMs) { settledDays++; settledSource += s; settledStored += t; }
    else { freshDays++; freshSource += s; freshStored += t; }
  }
  return {
    sharedDays: perDay.length,
    settledDays, settledSource, settledStored,
    settledDrift: settledStored > 0 ? Math.abs(settledSource - settledStored) / settledStored : 0,
    freshDays, freshSource, freshStored, perDay,
  };
}

function parseDay(raw: string): number {
  return Date.parse(raw.includes("T") ? raw : raw.replace(" UTC", "Z").replace(" ", "T"));
}

function completeDays(days: Iterable<string>, nowMs: number): Set<string> {
  const sorted = [...new Set(days)].sort();
  const out = new Set<string>();
  for (const [i, d] of sorted.entries()) {
    if (i === 0) continue; // the window's first day is partial
    if (Date.parse(d) + DAY > nowMs) continue; // today is partial
    out.add(d);
  }
  return out;
}

export function foldBuybackRows(rows: DuneRow[], opts: BuybackFoldOpts): BuybackFold {
  const minMatchRate = opts.minMatchRate ?? 0.5;
  const payouts = new Map<string, Map<string, number>>();
  const grossTier = new Map<string, Map<string, number>>();
  const grossFromRecipients = new Map<string, Map<string, number>>();
  const recipientDaySet = new Map<string, Set<string>>();
  const seen = new Map<string, Set<string>>();
  const matched = new Map<string, Set<string>>();
  const warnings: string[] = [];
  let recipientRows = 0, grossRows = 0, legacyRows = 0;
  const add = (m: Map<string, Map<string, number>>, key: string, day: string, usd: number) => {
    let days = m.get(key);
    if (!days) m.set(key, (days = new Map()));
    days.set(day, (days.get(day) ?? 0) + usd);
  };

  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    const isR3 = rec.p != null;
    const key = isR3 ? opts.platformByCode[String(rec.p ?? "")] : String(rec.platform ?? "");
    if (!key) continue;
    const raw = String((isR3 ? rec.d : rec.day) ?? "");
    const t = parseDay(raw);
    const usd = Number(isR3 ? rec.u : rec.payout_usd);
    if (!Number.isFinite(t) || !Number.isFinite(usd)) continue;
    const day = opts.dayStartUtc(t);

    if (!isR3) { legacyRows++; add(payouts, key, day, usd); continue; }

    const trusted = opts.trusted.has(key);
    const w = rec.w == null ? "" : String(rec.w).toLowerCase();
    if (w === "") {
      grossRows++;
      if (trusted) add(grossTier, key, day, usd);
      continue;
    }

    recipientRows++;
    let rd = recipientDaySet.get(key);
    if (!rd) recipientDaySet.set(key, (rd = new Set()));
    rd.add(day);
    if (trusted) add(grossFromRecipients, key, day, usd);
    const isSpender = !trusted || (opts.spenders.get(key)?.has(w) ?? false);
    if (trusted) {
      let s = seen.get(key);
      if (!s) seen.set(key, (s = new Set()));
      s.add(w);
      if (isSpender) {
        let h = matched.get(key);
        if (!h) matched.set(key, (h = new Set()));
        h.add(w);
      }
    }
    if (isSpender) add(payouts, key, day, usd);
  }

  // Gross: the gross tier where the query provides it, else summed from the
  // recipient rows (the pre-2026-09-22 shape).
  const useRecipientGross = grossRows === 0;
  const gross = useRecipientGross ? grossFromRecipients : grossTier;

  const match = new Map<string, { seen: number; hit: number; rate: number }>();
  for (const key of [...gross.keys()]) {
    const s = seen.get(key)?.size ?? 0;
    const h = matched.get(key)?.size ?? 0;
    const rate = s > 0 ? h / s : 0;
    if (s > 0) match.set(key, { seen: s, hit: h, rate });
    if (s > 0 && rate < minMatchRate) {
      warnings.push(
        `R3 classification FAILED for ${key}: only ${h.toLocaleString()}/${s.toLocaleString()} recipients (${(rate * 100).toFixed(1)}%) matched a gacha_pulls buyer — expected ~86%. Writing gross-of-list payouts and NO gross series for it.`,
      );
      gross.delete(key);
      payouts.set(key, new Map(grossFromRecipients.get(key) ?? []));
    }
  }

  const payoutDays = new Map<string, Set<string>>();
  for (const [key, days] of payouts) {
    const covered = recipientDaySet.get(key) ?? new Set(days.keys());
    payoutDays.set(key, completeDays(covered, opts.nowMs));
  }
  const grossDays = new Map<string, Set<string>>();
  for (const [key, days] of gross) grossDays.set(key, completeDays(days.keys(), opts.nowMs));

  return {
    basis: recipientRows + grossRows > 0 ? "r3" : "pre-r3",
    payouts, payoutDays, gross, grossDays, match,
    stats: { recipientRows, grossRows, legacyRows, recipientDays: Math.max(0, ...[...recipientDaySet.values()].map((s) => s.size)), grossFromRecipients: useRecipientGross && recipientRows > 0 },
    warnings,
  };
}
