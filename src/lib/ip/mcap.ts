import type { IPRow } from "@/lib/types";

/** Below this, a "market cap" is rounding noise rather than a valuation. */
const MCAP_FLOOR_USD = 1000;

/**
 * Does this IP have a market cap worth showing? The ONE rule — /ips renders the
 * same number through a rail row, a treemap, a leaderboard and an HHI, and three
 * private copies of this test is exactly how they came to disagree.
 *
 * ⚠️ Gate on the CAP'S OWN EXISTENCE, never on trading activity. `IPRow.cards`
 * counts cards TRADED in the last 24h (since D10-2), so keying a STOCK metric on
 * it made an IP's market cap blink out on a quiet day. On one page that produced
 * three answers: Moonbirds — the #3 IP by cap — vanished from the treemap
 * entirely, Sports zeroed out of the rail's own expansion, and Basketball's real
 * $567K hid because exactly four cards happened to change hands (while zero-trade
 * Football kept its cap, the gate never applying to it).
 *
 * A market cap is float × price. Neither term knows what traded today.
 */
export function hasRealMcap(ip: IPRow): boolean {
  return Number.isFinite(ip.mcapUsd) && ip.mcapUsd >= MCAP_FLOOR_USD;
}

/** The cap to COUNT for this IP — 0 when it hasn't got one, so a Σ stays finite
 *  even though `mcapUsd` is NaN for an untracked IP. */
export function qualifiedMcap(ip: IPRow): number {
  return hasRealMcap(ip) ? ip.mcapUsd : 0;
}
