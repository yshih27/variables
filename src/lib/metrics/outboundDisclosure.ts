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
 * This is a DISPLAY policy, not a computation: nothing here changes a sum.
 *
 * ⚠️ R3 HAS LANDED AND DID NOT LIFT PHYGITALS (Addendum A, 2026-08-19). R3 was
 * expected to be the unblock; measured, it moves Phygitals only 102.56% → 100.59%
 * — still above 1.0, net still negative. The residual is TEMPORAL, not a
 * counterparty problem: Phygitals' spend is down 79% in three months, and a
 * payout leg settling that larger cohort against today's smaller spend exceeds
 * 1.0 with nothing miscounted. R3 tests WHO the counterparty is, never WHAT the
 * transfer was for, so no amount of counterparty filtering closes it. The
 * suppression therefore stands until payouts are cohorted to the pulls they
 * settle. Do not add a second per-platform exception here — if a third platform
 * ever needs one, that is the signal to fix the counting, not this list.
 */
export type OutboundDisclosure = "gross" | "suppressed";

/** Platforms whose outbound leg is withheld. Keyed by PlatformSource.key. */
const SUPPRESSED = new Set<string>(["phygitals"]);

export function outboundDisclosureFor(platformKey: string): OutboundDisclosure {
  return SUPPRESSED.has(platformKey) ? "suppressed" : "gross";
}

/**
 * Why `PlatformDetail.netGachaRevenue` is null. Null reason ⇒ it is populated.
 *
 *   "unsourced"          no known on-chain buyback wallet — every platform but
 *                        CC and Phygitals. Nothing to compute, ever.
 *   "reconciliation"     sourced, but the counting is known-wrong for this
 *                        platform. Phygitals: see the header note.
 *   "awaiting-r3-basis"  sourced and eligible, but the spine's payout days are
 *                        not yet proven to be on the R3 basis. Transitional —
 *                        it clears itself once the Dune cutover has run.
 */
export type NetHeldReason =
  | "unsourced"
  | "reconciliation"
  | "awaiting-r3-basis"
  | "spender-coverage";

/**
 * ⚠️ NET IS HELD FOR EVERYONE while R3 is classified from `gacha_pulls.buyer`.
 *
 * The cheap R3 path (one Dune scan + a Postgres spender set) is accurate enough
 * for the FLOWS and the RATE, and not accurate enough for NET. Measured
 * 2026-08-19 against the two-scan Dune query over the same window:
 *
 *     CC gross outflow    −0.11%   (windows differ slightly; this is the floor)
 *     CC R3 payouts       −0.61%   ← 1,417 of 10,961 recipients unmatched
 *     CC buyback rate     −0.59pp  (94.33% vs 94.92%) — immaterial
 *     CC NET              +11.5%   ($9.50M vs $8.52M / 35d) — NOT immaterial
 *
 * Net is a small difference of two large numbers: it is ~5% of spend, so a 0.6%
 * error in the payout leg is levered ~20× into it, and it lands in the flattering
 * direction because a missing spender means a payout is dropped. The wallets we
 * miss are real — they paid the gacha receivers on-chain — we simply have no pull
 * recorded for them.
 *
 * So the R3 lift ruled in Addendum A §A7 stands as a decision but cannot be
 * served off this measurement. Flip this to `false` when either the spender set
 * is complete enough (re-measure the match rate; it needs to be ~99%, not 87%),
 * or a periodic two-scan reconciliation corrects the payout leg. Everything else
 * — the R3-counted payout series, the rate, the R3-verified share — ships now.
 */
export const NET_HELD_FOR_SPENDER_COVERAGE = true;

/**
 * May this platform publish a NET figure (spend − payouts) at all?
 *
 * Separate from `outboundDisclosureFor` on purpose: showing a flow and asserting
 * a margin are different claims with different evidence bars. A platform can pass
 * this and still fail on data grounds — eligibility is necessary, not sufficient,
 * and fetchPlatform applies the R3-basis check on top.
 */
export function netRevenueEligible(platformKey: string): boolean {
  return !SUPPRESSED.has(platformKey);
}
