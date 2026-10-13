/**
 * Courtyard's buyback arbitrage: a peer-to-peer purchase whose buyer sells the
 * same card to Courtyard's buyback within 24 hours.
 *
 * Courtyard buys pulled cards back from players, its operations wallet bidding on
 * its own exchange (exchange.ts). Wallets that buy listings under the buyback
 * price and sell them straight to that wallet make real trades between distinct
 * parties, but not collector resale. Measured Oct 13 2026 from Polygon: 13.4% of
 * peer-to-peer dollars on Oct 11 (1,791 of 5,970 trades) and 63.2% on Aug 3, the
 * peak of the summer spike (24,372 of 30,810). The owner's ruling (Oct 13):
 * exclude them from resale, and say how much on a receipt line.
 *
 * The rule, per purchase: a peer-to-peer trade at T is arbitrage when its bidder
 * is the asker of a buyback on the same token in [T, T + 24 h]. One buyback
 * settles one purchase: that wallet's latest open purchase of the card.
 */

import type { ExchangeTrade } from "./exchange";

export const ARBITRAGE_WINDOW_MS = 24 * 3_600_000;

export type OpenPurchase = { id: string; bidder: string; tokenId: string; ms: number };

/**
 * Matches purchases to later buybacks. Feed it in chain order (block, then log
 * index): a purchase and its buyback in the same block then match, and a buyback
 * never settles a purchase that comes after it.
 */
export class ArbitrageMatcher {
  private open = new Map<string, OpenPurchase[]>();

  constructor(private readonly windowMs = ARBITRAGE_WINDOW_MS) {}

  /** A peer-to-peer purchase. */
  purchase(p: OpenPurchase): void {
    const k = `${p.bidder}|${p.tokenId}`;
    const list = this.open.get(k);
    if (list) list.push(p);
    else this.open.set(k, [p]);
  }

  /** A buyback: the id of the purchase it settles, or null. */
  buyback(asker: string, tokenId: string, ms: number): string | null {
    const k = `${asker}|${tokenId}`;
    const list = this.open.get(k);
    if (!list) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.ms <= ms && ms - p.ms <= this.windowMs) {
        list.splice(i, 1);
        if (!list.length) this.open.delete(k);
        return p.id;
      }
    }
    return null;
  }

  /** Forget purchases no buyback at or after `nowMs` can settle any more. */
  prune(nowMs: number): void {
    for (const [k, list] of this.open) {
      const keep = list.filter((p) => nowMs - p.ms <= this.windowMs);
      if (keep.length) this.open.set(k, keep);
      else this.open.delete(k);
    }
  }

  /** Purchases still waiting for a buyback. */
  get pending(): number {
    let n = 0;
    for (const list of this.open.values()) n += list.length;
    return n;
  }
}

/** A trade's id in the `secondary_sales` store (salesStore.ts uses the same). */
export const exchangeSaleId = (t: Pick<ExchangeTrade, "txHash" | "logIndex">): string => `courtyard:${t.txHash}:${t.logIndex}`;

/**
 * Classify trades already in chain order: the ids of the purchases that are
 * arbitrage. Pure; the measurement script and the tests use it, the live feed
 * drives the matcher itself because it writes as it reads.
 */
export function arbitrageIds(trades: readonly ExchangeTrade[], windowMs = ARBITRAGE_WINDOW_MS): Set<string> {
  const m = new ArbitrageMatcher(windowMs);
  const out = new Set<string>();
  for (const t of trades) {
    const ms = Date.parse(t.ts);
    if (t.kind === "p2p") m.purchase({ id: exchangeSaleId(t), bidder: t.bidder, tokenId: t.tokenId, ms });
    else {
      const hit = m.buyback(t.asker, t.tokenId, ms);
      if (hit) out.add(hit);
    }
  }
  return out;
}

export type DayTally = {
  /** Peer-to-peer trades that stay resale. */
  resaleN: number;
  resaleUsd: number;
  /** Peer-to-peer trades settled by a buyback within the window. */
  arbN: number;
  arbUsd: number;
  buybackN: number;
  buybackUsd: number;
};

export const emptyTally = (): DayTally => ({ resaleN: 0, resaleUsd: 0, arbN: 0, arbUsd: 0, buybackN: 0, buybackUsd: 0 });

/** Per UTC day (ISO midnight), each trade on the day it happened. Pure. */
export function tallyByDay(trades: readonly ExchangeTrade[], arb: ReadonlySet<string>): Map<string, DayTally> {
  const days = new Map<string, DayTally>();
  for (const t of trades) {
    const day = `${t.ts.slice(0, 10)}T00:00:00.000Z`;
    const d = days.get(day) ?? emptyTally();
    if (t.kind === "buyback") {
      d.buybackN++;
      d.buybackUsd += t.usd;
    } else if (arb.has(exchangeSaleId(t))) {
      d.arbN++;
      d.arbUsd += t.usd;
    } else {
      d.resaleN++;
      d.resaleUsd += t.usd;
    }
    days.set(day, d);
  }
  return days;
}
