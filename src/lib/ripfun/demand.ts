/**
 * WHICH printings deserve a comp — ranked from OUR OWN trading, not CardOS's.
 *
 * ⚠️ THE EXPANSION LIST IS CHOSEN BY DEMAND, AND THAT IS THE WHOLE CREDIT PLAN.
 * CardOS holds ~37K Pokémon printings; walking all of them is 474 credits, the
 * entire month. What we actually need comps for is the few hundred printings our
 * platforms trade, and those cluster into a few dozen sets. So: rank our own 30d
 * secondary sales by printing, take the sets that cover the head of that
 * distribution, and walk only those.
 *
 * The ranking reads the SAME stores the trending panel does (the platform-keyed
 * secondary-sales snapshot), so "what we trade" means one thing across the app.
 */
import { readSecondarySalesSnapshot } from "../data/secondarySalesCache";
import { db } from "../db/client";
import {
  identityFromCardRow,
  printingKey,
  type CardLang,
  type CardRowForIdentity,
} from "./identity";

const DAY = 86_400_000;

export type TradedPrinting = {
  /** The grade-free join key (src/lib/ripfun/identity.ts). */
  key: string;
  ip: string;
  lang: CardLang;
  setRaw: string | null;
  number: string;
  name: string;
  /** 30d trade count across every platform that holds this printing. */
  trades: number;
  /** Canonical grade labels seen trading, e.g. ["PSA 10","CGC 9"]. Drives which
   *  printings deserve the pricier per-card graded-ladder call. */
  grades: string[];
};

export type DemandRanking = {
  printings: TradedPrinting[];
  totalTrades: number;
  skipped: {
    /** Rows whose token has no `cards` row at all. */
    noCard: number;
    /** Rows we hold metadata for but that cannot identify a printing (no name or
     *  no number) — honest: these simply never get a comp. */
    noIdentity: number;
  };
};

/**
 * Rank the printings our platforms traded over `days`.
 *
 * Reads sales from the secondary-sales store and joins them to `cards` in bulk.
 * Deliberately platform-AGNOSTIC on the way out: the same physical printing
 * trading on Collector Crypt and on Beezie is one printing needing one comp, and
 * merging them here is what keeps the mapped-set list short.
 */
export async function rankTradedPrintings(opts: { days?: number } = {}): Promise<DemandRanking> {
  const days = opts.days ?? 30;
  const since = Date.now() - days * DAY;
  const snap = await readSecondarySalesSnapshot();

  // platform → tokenIds traded in the window.
  const traded = new Map<string, Map<string, number>>();
  for (const [platform, sales] of Object.entries(snap?.platforms ?? {})) {
    const byToken = new Map<string, number>();
    for (const s of sales ?? []) {
      const t = Date.parse(s.date);
      if (!Number.isFinite(t) || t < since) continue;
      if (!s.tokenId) continue;
      byToken.set(s.tokenId, (byToken.get(s.tokenId) ?? 0) + 1);
    }
    if (byToken.size) traded.set(platform, byToken);
  }

  const printings = new Map<string, TradedPrinting>();
  const gradesSeen = new Map<string, Set<string>>();
  let noCard = 0;
  let noIdentity = 0;
  let totalTrades = 0;

  for (const [platform, byToken] of traded) {
    const ids = [...byToken.keys()];
    const CHUNK = 300;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { data, error } = await db()
        .from("cards")
        .select("token_id,card_name,set_name,grade_label,ip_key,attributes")
        .eq("platform", platform)
        .in("token_id", slice);
      if (error) throw new Error(`[ripfun/demand] cards read failed: ${error.message}`);
      const rows = new Map((data ?? []).map((r) => [r.token_id as string, r as unknown as CardRowForIdentity]));
      for (const tokenId of slice) {
        const n = byToken.get(tokenId) ?? 0;
        const row = rows.get(tokenId);
        if (!row) { noCard += n; continue; }
        const id = identityFromCardRow(row);
        const key = printingKey(id);
        if (!key) { noIdentity += n; continue; }
        totalTrades += n;
        const cur = printings.get(key);
        if (cur) cur.trades += n;
        else
          printings.set(key, {
            key,
            ip: id.ip,
            lang: id.lang,
            setRaw: id.setRaw,
            number: id.number!,
            name: id.name!,
            trades: n,
            grades: [],
          });
        if (id.grade) {
          const g = gradesSeen.get(key) ?? new Set<string>();
          g.add(id.grade.label);
          gradesSeen.set(key, g);
        }
      }
    }
  }

  for (const [key, g] of gradesSeen) {
    const p = printings.get(key);
    if (p) p.grades = [...g].sort();
  }

  return {
    printings: [...printings.values()].sort((a, b) => b.trades - a.trades),
    totalTrades,
    skipped: { noCard, noIdentity },
  };
}
