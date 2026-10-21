/**
 * Per-IP daily wallets and cards traded, for the metric spine (scripts/
 * warm-metric-snapshots.ts): the daily series behind an IP page's Active Wallets
 * and Cards Traded chart lines, counted over the same venues as their live 24h
 * values (IP_RESALE_VENUES).
 */
import type { NormalizedSale } from "@/lib/rarible/queries";
import type { CardDims } from "./cards";
import { dayStartUtc } from "./metricSnapshots";

export type IpFeed = { platform: string; sales: NormalizedSale[]; dims: Map<string, Pick<CardDims, "ip">> };
export type IpDayAcc = { wallets: Set<string>; cards: Set<string> };

/**
 * Per UTC day, per IP: the distinct wallets (buyer ∪ seller) and distinct cards
 * that changed hands, across every feed given. A sale whose token has no `cards`
 * row has no IP and is left out: it still counts in its venue's totals, which are
 * written elsewhere, but filing it under "other" would credit the catch-all IP
 * with sales that belong to unknown IPs. Card keys carry the venue, so one token
 * id on two venues is two cards; wallets are raw addresses (a Solana and an EVM
 * address cannot collide).
 */
export function ipWalletsCardsByDay(feeds: IpFeed[]): Map<string, Map<string, IpDayAcc>> {
  const out = new Map<string, Map<string, IpDayAcc>>();
  for (const { platform, sales, dims } of feeds) {
    for (const s of sales) {
      const ip = dims.get(s.tokenId)?.ip;
      const t = Date.parse(s.date);
      if (!ip || !Number.isFinite(t)) continue;
      const day = dayStartUtc(t);
      let dayMap = out.get(day);
      if (!dayMap) out.set(day, (dayMap = new Map()));
      let acc = dayMap.get(ip);
      if (!acc) dayMap.set(ip, (acc = { wallets: new Set(), cards: new Set() }));
      if (s.buyer) acc.wallets.add(s.buyer);
      if (s.seller) acc.wallets.add(s.seller);
      if (s.tokenId) acc.cards.add(`${platform}:${s.tokenId}`);
    }
  }
  return out;
}

/**
 * The stored per-IP rows a spine run must set to 0: a (key, day) already in the
 * spine, on a day this run rewrites (`rewrites`), that the run computed nothing
 * for (`fresh`: day → key → …, days as dayStartUtc). The spine only upserts, so
 * without this a day an IP no longer trades on — after a reclassification moves
 * its cards (Oct 2026: ~850 out of "other"), or once unmatched sales stop counting
 * — would keep its old value, and the same sale would sit in two IPs' series.
 */
export function staleIpDays(
  stored: Map<string, { ts: string; value: number }[]>,
  fresh: Map<string, Map<string, unknown>>,
  rewrites: (day: string) => boolean,
): { key: string; day: string }[] {
  const out: { key: string; day: string }[] = [];
  for (const [key, series] of stored) {
    for (const p of series) {
      const t = Date.parse(p.ts);
      if (!Number.isFinite(t) || p.value === 0) continue;
      const day = dayStartUtc(t);
      if (!rewrites(day) || fresh.get(day)?.has(key)) continue;
      out.push({ key, day });
    }
  }
  return out;
}
