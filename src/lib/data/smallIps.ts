/**
 * "Smaller IPs": the ones with too little measured activity to rank beside the
 * rest — market cap under the floor, no trade in the last 24 hours, and pack
 * spend under the floor over 30 days. The Categories table lists them in a
 * collapsed group at its foot; their pages and rows stay, nothing is hidden.
 * Other, the catch-all, is never grouped. Client-safe.
 *
 * Every measure must be known: an unknown is not "under the floor". A market cap
 * or trade count we don't have keeps the IP in the main rows, and without the
 * pack-spend map (its read failed) nothing is grouped.
 *
 * Oct 23 2026 (owner: "group the smaller IPs"): F1 ($515), VeeFriends ($30) and
 * Sneakers ($7) sat in the table with no trade and no pack sold. Lorcana's cap is
 * $241 too, but $358K of packs sold over 30 days keeps it in the main rows.
 */
import { formatCompactUsd } from "../format";

export const SMALL_IP_FLOOR_USD = 10_000;

/** The floor as the group's rule prints it: "$10K", not "$10.0K". */
export const SMALL_IP_FLOOR_LABEL = formatCompactUsd(SMALL_IP_FLOOR_USD).replace(/\.0(?=[KMB]$)/, "");

/**
 * @param packSpend 30-day pack spend by IP, as the Packs 30d column shows it. An
 *   IP absent from it sold no packs on the venues read; an entry that isn't a
 *   number is unknown.
 */
export function isSmallIp(
  ip: { key: string; mcapUsd: number; trades24h: number },
  packSpend: Readonly<Record<string, number | null>> | null | undefined,
): boolean {
  if (!packSpend || ip.key === "other") return false;
  const packs = Object.prototype.hasOwnProperty.call(packSpend, ip.key) ? packSpend[ip.key] : 0;
  return (
    Number.isFinite(ip.mcapUsd) && ip.mcapUsd < SMALL_IP_FLOOR_USD &&
    ip.trades24h === 0 &&
    typeof packs === "number" && Number.isFinite(packs) && packs < SMALL_IP_FLOOR_USD
  );
}
