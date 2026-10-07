/**
 * Renaiss's machine board — per pack machine, over 30 COMPLETE days of
 * `renaiss_pulls`: its price, spend, pulls, the value Renaiss STATES its prizes
 * are worth against what was paid, and its top prize. Written to its own
 * snapshot, `machines:renaiss`, by scripts/warm-renaiss-machines.ts.
 *
 * ⚠️ A WINDOWED READ, NEVER A SCAN. 30 days is about 60,000 pulls, read one UTC
 * day at a time over the `pulled_at` index. Player analytics' full scan of
 * `gacha_pulls` took 38.6 min on Oct 6 and is why the daily job timed out;
 * Renaiss is not added to it, and nothing here touches it.
 *
 * ⚠️ STATED VALUE IS RENAISS'S CLAIM. `prize_value_usd` is the value Renaiss
 * states for a prize, never a price anyone paid. Every figure built on it
 * carries the board's `valueBasis`, and "value back" and "hit share" are
 * measured in it, over the pulls that carry both a price and a stated value
 * (their n travels as `hitN`). No pull probability is computed or implied.
 *
 * ⚠️ NO PARTNER FIELDS. Renaiss's pulls name no originating storefront, so the
 * board carries none of Collector Crypt's partner split, rather than zeros.
 */
import { db } from "../db/client";
import { readSnapshot, writeSnapshot } from "../db/snapshots";
import type { MachineBoard, MachinePrize, MachineRow } from "../data/playerAnalytics";
import { RENAISS_MACHINE_WINDOW_DAYS } from "./constants";

export const RENAISS_MACHINES_SNAPSHOT_KEY = "machines:renaiss";
export const RENAISS_VALUE_BASIS = "Renaiss's stated prize value";
export { RENAISS_MACHINE_WINDOW_DAYS };

const DAY_MS = 86_400_000;

/** The columns the board reads from one pull. */
export type BoardPull = {
  kind: string;
  product_id: string;
  machine_name: string | null;
  price_usd: number | string | null;
  pulled_at: string;
  prize_value_usd: number | string | null;
  prize_card_name: string | null;
  prize_grade_label: string | null;
  prize_image_url: string | null;
};

const num = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type Acc = {
  name: string | null;
  nameAt: number;
  price: number | null;
  priceAt: number;
  pulls: number;
  spend: number;
  spend7d: number;
  pulls24h: number;
  stated: number;
  bothPaid: number;
  bothStated: number;
  hitN: number;
  hits: number;
  top: MachinePrize | null;
};

/**
 * The board, pure. `nowMs` fixes the window: [today's UTC midnight − 30 days,
 * today's UTC midnight) — complete days only, as Collector Crypt's board.
 *
 * Per machine:
 *   • pulls / spend: CHECKOUT rows only (an `observed` row is a draw whose
 *     checkout is not matched yet: no buyer, no price, never spend);
 *   • price: the price its newest checkout in the window paid. Renaiss
 *     publishes no catalog, and a machine's name carries its price ("PANDORA
 *     28"), so the newest paid price is its sticker, not an average;
 *   • name: its newest non-empty `machine_name`, else its id;
 *   • value back and hit share: over checkouts carrying a stated value;
 *   • top prize: the pull with the highest stated value, observed rows included
 *     (a prize is a prize whether or not its checkout is matched yet).
 */
export function buildRenaissMachineBoard(pulls: BoardPull[], nowMs: number = Date.now()): MachineBoard | null {
  const todayStart = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const from = todayStart - RENAISS_MACHINE_WINDOW_DAYS * DAY_MS;
  const from7 = todayStart - 7 * DAY_MS;
  const from1 = todayStart - DAY_MS;
  const byMachine = new Map<string, Acc>();
  for (const p of pulls) {
    const t = Date.parse(p.pulled_at);
    if (!Number.isFinite(t) || t < from || t >= todayStart || !p.product_id) continue;
    let a = byMachine.get(p.product_id);
    if (!a) {
      a = { name: null, nameAt: -Infinity, price: null, priceAt: -Infinity, pulls: 0, spend: 0, spend7d: 0, pulls24h: 0, stated: 0, bothPaid: 0, bothStated: 0, hitN: 0, hits: 0, top: null };
      byMachine.set(p.product_id, a);
    }
    const name = p.machine_name?.trim();
    if (name && t > a.nameAt) {
      a.name = name;
      a.nameAt = t;
    }
    const value = num(p.prize_value_usd);
    if (value != null && value > 0 && (!a.top || value > a.top.valueUsd)) {
      a.top = { cardName: p.prize_card_name, grade: p.prize_grade_label, valueUsd: value, image: p.prize_image_url, pulledAt: new Date(t).toISOString() };
    }
    const price = num(p.price_usd);
    if (p.kind !== "checkout" || price == null || !(price > 0)) continue;
    a.pulls += 1;
    a.spend += price;
    if (t >= from7) a.spend7d += price;
    if (t >= from1) a.pulls24h += 1;
    if (t > a.priceAt) {
      a.price = price;
      a.priceAt = t;
    }
    if (value != null && value >= 0) {
      a.stated += value;
      a.bothPaid += price;
      a.bothStated += value;
      a.hitN += 1;
      if (value >= price) a.hits += 1;
    }
  }
  const rows: MachineRow[] = [...byMachine.entries()]
    .filter(([, a]) => a.pulls > 0 || a.top)
    .map(([key, a]) => ({
      key,
      name: a.name ?? key,
      priceUsd: a.price,
      pulls: a.pulls,
      spendUsd: a.spend,
      spend7dUsd: a.spend7d,
      pulls24h: a.pulls24h,
      statedValueUsd: a.stated,
      valueBackPct: a.bothPaid > 0 ? (a.bothStated / a.bothPaid) * 100 : null,
      hitSharePct: a.hitN > 0 ? (a.hits / a.hitN) * 100 : null,
      hitN: a.hitN,
      topPrize: a.top,
    }))
    .sort((x, y) => y.spendUsd - x.spendUsd);
  if (!rows.length) return null;
  return {
    windowDays: RENAISS_MACHINE_WINDOW_DAYS,
    asOf: new Date(todayStart - DAY_MS).toISOString(),
    valueBasis: RENAISS_VALUE_BASIS,
    rows,
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

const BOARD_COLUMNS = "pull_id, kind, product_id, machine_name, price_usd, pulled_at, prize_value_usd, prize_card_name, prize_grade_label, prize_image_url";
/** Before migration 20261007000001: no name, no image. */
const BOARD_COLUMNS_PRE = "pull_id, kind, product_id, price_usd, pulled_at, prize_value_usd, prize_card_name, prize_grade_label";

/**
 * Every pull from `fromMs` to `toMs` (UTC midnights), one day per query over
 * the `pulled_at` index, paged past the 1,000-row cap. Falls back to the
 * pre-migration columns (no name, no image) when the two new ones are absent.
 */
export async function readBoardPulls(fromMs: number, toMs: number, log: (l: string) => void = () => {}): Promise<{ pulls: BoardPull[]; queries: number; preMigration: boolean }> {
  const PAGE = 1000;
  const pulls: BoardPull[] = [];
  let queries = 0;
  let columns = BOARD_COLUMNS;
  let preMigration = false;
  for (let d = fromMs; d < toMs; d += DAY_MS) {
    const day = new Date(d).toISOString();
    const end = new Date(Math.min(d + DAY_MS, toMs)).toISOString();
    for (let from = 0; ; from += PAGE) {
      const q = () =>
        db()
          .from("renaiss_pulls")
          .select(columns)
          .gte("pulled_at", day)
          .lt("pulled_at", end)
          .order("pull_id", { ascending: true })
          .range(from, from + PAGE - 1);
      let { data, error } = await q();
      queries++;
      if (error && !preMigration && /machine_name|prize_image_url/.test(error.message)) {
        preMigration = true;
        columns = BOARD_COLUMNS_PRE;
        log("  renaiss_pulls has no machine_name / prize_image_url yet (migration 20261007000001): names fall back to machine ids, prizes carry no image");
        ({ data, error } = await q());
        queries++;
      }
      if (error) throw new Error(`[renaiss_pulls] board read failed (${day.slice(0, 10)}): ${error.message}`);
      const rows = (data ?? []) as unknown as BoardPull[];
      for (const r of rows) pulls.push({ ...r, machine_name: r.machine_name ?? null, prize_image_url: r.prize_image_url ?? null });
      if (rows.length < PAGE) break;
    }
  }
  return { pulls, queries, preMigration };
}

/**
 * The 12 biggest prizes by stated value over the trailing `days` complete
 * days, one query: the window rides the `pulled_at` index, the sort is over the
 * window only. Returned as the board's prize shape plus the machine.
 */
export async function readRenaissBiggestPulls(days: number, nowMs: number = Date.now(), limit = 12): Promise<(MachinePrize & { machine: string | null })[]> {
  const todayStart = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const run = (cols: string) =>
    db()
      .from("renaiss_pulls")
      .select(cols)
      .gte("pulled_at", new Date(todayStart - days * DAY_MS).toISOString())
      .lt("pulled_at", new Date(todayStart).toISOString())
      .not("prize_value_usd", "is", null)
      .order("prize_value_usd", { ascending: false })
      .limit(limit);
  let { data, error } = await run("product_id, machine_name, pulled_at, prize_value_usd, prize_card_name, prize_grade_label, prize_image_url");
  if (error && /machine_name|prize_image_url/.test(error.message)) {
    ({ data, error } = await run("product_id, pulled_at, prize_value_usd, prize_card_name, prize_grade_label"));
  }
  if (error) throw new Error(`[renaiss_pulls] biggest pulls read failed: ${error.message}`);
  return ((data ?? []) as unknown as (BoardPull & { product_id: string })[]).map((r) => ({
    cardName: r.prize_card_name,
    grade: r.prize_grade_label,
    valueUsd: Number(r.prize_value_usd),
    image: r.prize_image_url ?? null,
    pulledAt: new Date(r.pulled_at).toISOString(),
    // The feed's name or nothing: a raw machine id is not a name (BiggestPull.machine
    // is "where the feed names one"); the page prints "—" until the refill names it.
    machine: r.machine_name ?? null,
  }));
}

export function readRenaissMachineBoard(): Promise<MachineBoard | null> {
  return readSnapshot<MachineBoard>(RENAISS_MACHINES_SNAPSHOT_KEY);
}

export function writeRenaissMachineBoard(board: MachineBoard): Promise<void> {
  return writeSnapshot(RENAISS_MACHINES_SNAPSHOT_KEY, board, new Date().toISOString());
}
