/**
 * Audit Varible's Renaiss players per month against Renaiss's own feed
 * (GET /v1/gacha/pulls), independent of our database. Pages every pull from
 * --from to --to and counts, per UTC month: distinct checkout buyers (players),
 * the wallets whose first pull falls in that month (first-time), and paid USD.
 * Reads the API only; writes local JSON only.
 *
 *   RENAISS_MAX_CALLS=2400 npx tsx --env-file=.env.local scripts/dev/audit-renaiss-players.ts \
 *     --from=2025-11-01 --to=2026-10-01 --out=<dir>            # about 1,600 pages from Nov 2025
 *   … --resume   continue from <dir>/checkpoint.json (written every 25 pages)
 *
 * Two readings of each count, so a definitional gap shows up as itself:
 *   - "ours": what renaiss/players.ts publishes. Players = distinct buyers of
 *     checkout rows (any price); first-time = wallets whose earliest PRICED pull
 *     (price > 0, any kind, as renaiss_wallet_spend() reads) is in the month,
 *     capped at the month's players.
 *   - "strict": players = distinct buyers of checkouts with a price above 0;
 *     first-time = wallets whose earliest such checkout is in the month.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fetchPullsPage, usdOf } from "../../src/lib/renaiss/pulls";
import { RENAISS_PAGE_SIZE, renaissCallCount } from "../../src/lib/renaiss/client";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;

type State = {
  from: string;
  to: string;
  cursor: string | null;
  pages: number;
  rows: number;
  checkouts: number;
  lastPulledAt: string | null;
  /** month → buyers with a checkout (any price) */
  ck: Record<string, string[]>;
  /** month → buyers with a checkout priced above 0 */
  paid: Record<string, string[]>;
  /** buyer → earliest pulledAt among priced rows of any kind */
  firstPriced: Record<string, string>;
  /** buyer → earliest pulledAt among priced checkouts */
  firstPaidCk: Record<string, string>;
  /** month → USD of priced checkouts */
  spend: Record<string, number>;
};

function toSets(rec: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(rec).map(([k, v]) => [k, new Set(v)]));
}
function fromSets(m: Map<string, Set<string>>): Record<string, string[]> {
  return Object.fromEntries([...m.entries()].map(([k, v]) => [k, [...v]]));
}

async function main() {
  const out = arg("out");
  const fromDay = arg("from") ?? "2025-11-01";
  const toDay = arg("to") ?? "2026-10-01";
  if (!out) throw new Error("--out=<dir> is required");
  mkdirSync(out, { recursive: true });
  const fromIso = `${fromDay}T00:00:00.000Z`;
  const untilIso = `${toDay}T00:00:00.000Z`;
  const ckPath = join(out, "checkpoint.json");

  let st: State = { from: fromIso, to: untilIso, cursor: null, pages: 0, rows: 0, checkouts: 0, lastPulledAt: null, ck: {}, paid: {}, firstPriced: {}, firstPaidCk: {}, spend: {} };
  if (process.argv.includes("--resume") && existsSync(ckPath)) {
    st = JSON.parse(readFileSync(ckPath, "utf8")) as State;
    if (st.from !== fromIso || st.to !== untilIso) throw new Error(`checkpoint is for ${st.from} → ${st.to}`);
    console.log(`resuming at page ${st.pages} · ${st.rows.toLocaleString()} rows · last ${st.lastPulledAt}`);
  }
  const ck = toSets(st.ck);
  const paid = toSets(st.paid);
  const firstPriced = new Map(Object.entries(st.firstPriced));
  const firstPaidCk = new Map(Object.entries(st.firstPaidCk));
  const spend = new Map(Object.entries(st.spend));

  const save = () => {
    st.ck = fromSets(ck);
    st.paid = fromSets(paid);
    st.firstPriced = Object.fromEntries(firstPriced);
    st.firstPaidCk = Object.fromEntries(firstPaidCk);
    st.spend = Object.fromEntries(spend);
    writeFileSync(ckPath, JSON.stringify(st));
  };

  const t0 = Date.now();
  let done = st.pages > 0 && st.cursor == null;
  while (!done) {
    const res = await fetchPullsPage(st.cursor ? { after: st.cursor, limit: RENAISS_PAGE_SIZE } : { from: fromIso, limit: RENAISS_PAGE_SIZE });
    st.pages++;
    for (const r of res.rows) {
      if (r.pulledAt < fromIso || r.pulledAt >= untilIso) continue;
      st.rows++;
      const buyer = r.buyer?.toLowerCase();
      if (!buyer) continue;
      const month = r.pulledAt.slice(0, 7);
      const usd = usdOf(r.pricePaid);
      const priced = usd != null && usd > 0;
      if (priced) {
        const f = firstPriced.get(buyer);
        if (!f || r.pulledAt < f) firstPriced.set(buyer, r.pulledAt);
      }
      if (r.kind !== "checkout") continue;
      st.checkouts++;
      let a = ck.get(month);
      if (!a) ck.set(month, (a = new Set()));
      a.add(buyer);
      if (priced) {
        let b = paid.get(month);
        if (!b) paid.set(month, (b = new Set()));
        b.add(buyer);
        spend.set(month, (spend.get(month) ?? 0) + usd);
        const f = firstPaidCk.get(buyer);
        if (!f || r.pulledAt < f) firstPaidCk.set(buyer, r.pulledAt);
      }
    }
    const last = res.rows[res.rows.length - 1];
    if (last) st.lastPulledAt = last.pulledAt;
    st.cursor = res.hasMore && res.nextCursor && last && last.pulledAt < untilIso ? res.nextCursor : null;
    done = st.cursor == null;
    if (st.pages % 25 === 0 || done) {
      save();
      console.log(
        `page ${st.pages} · ${st.rows.toLocaleString()} rows · through ${st.lastPulledAt} · X-RateLimit-Remaining ${res.rate?.remaining ?? "?"} · ${((Date.now() - t0) / 1000).toFixed(0)}s`,
      );
    }
  }

  // Per-month counts, both readings.
  const firstByMonth = (m: Map<string, string>) => {
    const outM = new Map<string, number>();
    for (const at of m.values()) outM.set(at.slice(0, 7), (outM.get(at.slice(0, 7)) ?? 0) + 1);
    return outM;
  };
  const fPriced = firstByMonth(firstPriced);
  const fStrict = firstByMonth(firstPaidCk);
  const months = [...new Set([...ck.keys(), ...paid.keys()])].sort();
  const table = months.map((month) => {
    const players = ck.get(month)?.size ?? 0;
    const playersStrict = paid.get(month)?.size ?? 0;
    return {
      month,
      ours: { players, firstTime: Math.min(players, fPriced.get(month) ?? 0) },
      strict: { players: playersStrict, firstTime: fStrict.get(month) ?? 0 },
      paidUsd: Math.round(spend.get(month) ?? 0),
    };
  });
  const report = { source: "Renaiss GET /v1/gacha/pulls", from: fromIso, to: untilIso, pages: st.pages, rows: st.rows, checkouts: st.checkouts, wallets: firstPriced.size, months: table, apiCalls: renaissCallCount() };
  writeFileSync(join(out, "players-audit.json"), JSON.stringify(report, null, 1));
  console.log(`\nmonth     players  first  returning │ strict players  first  returning │ paid USD`);
  for (const r of table) {
    const ret = (p: { players: number; firstTime: number }) => (p.players ? `${((100 * (p.players - p.firstTime)) / p.players).toFixed(1)}%` : "—");
    console.log(
      `${r.month}  ${String(r.ours.players).padStart(7)} ${String(r.ours.firstTime).padStart(6)} ${ret(r.ours).padStart(9)}  │ ${String(r.strict.players).padStart(14)} ${String(r.strict.firstTime).padStart(6)} ${ret(r.strict).padStart(9)}  │ ${r.paidUsd.toLocaleString()}`,
    );
  }
  console.log(`\n${renaissCallCount()} API calls this process · ${st.pages} pages total · wrote ${join(out, "players-audit.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
