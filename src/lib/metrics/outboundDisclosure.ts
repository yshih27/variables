/**
 * How much of a platform's gacha-wallet OUTFLOW we are willing to publish.
 *
 * Both covered platforms (Collector Crypt, Phygitals) have a known on-chain
 * buyback wallet, and the flow we measure off it — gross outbound USDC — is
 * correctly measured. What it is NOT is "buyback payouts to players", which is
 * what the old label claimed. See docs/roadmap/net-gacha-reconciliation.md §5.
 *
 *   • "gross"      — publish the flow under a label that says what it is: gross
 *                    outbound, players AND partners, non-player counterparties
 *                    included. CC's exclusion list is hand-curated but real: its
 *                    single largest counterparty ($228,898/transfer) is already
 *                    excluded, and what remains has a plausible player shape
 *                    ($23–$600 average over hundreds of transfers) (§3c).
 *
 *   • "suppressed" — publish nothing on the outbound side. Phygitals excludes
 *                    exactly one wallet and it is not one of the big ones: its
 *                    four largest recipients — including a single $566,679
 *                    transfer — are all counted as player buybacks today (§3d).
 *                    The resulting 102.9% "buyback rate" is an artifact of that
 *                    omission, not a business fact, and a rate above 100% is
 *                    arithmetic proof that non-player flow is inside the number.
 *                    Spend is a separate query and is unaffected, so the panel
 *                    keeps its spend series and says the outbound side is held.
 *
 * This is a DISPLAY policy, not a computation: nothing here changes a sum. The
 * suppression lifts when rule R3 lands (a payout counts only if the recipient
 * has spent in), which is self-maintaining and needs no per-platform list — at
 * which point this module should shrink to nothing rather than grow a second
 * exception.
 */
export type OutboundDisclosure = "gross" | "suppressed";

/** Platforms whose outbound leg is withheld pending R3. Keyed by PlatformSource.key. */
const SUPPRESSED = new Set<string>(["phygitals"]);

export function outboundDisclosureFor(platformKey: string): OutboundDisclosure {
  return SUPPRESSED.has(platformKey) ? "suppressed" : "gross";
}
