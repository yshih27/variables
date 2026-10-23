/**
 * "Smaller IPs": the ones with too little measured activity to rank beside the
 * rest — market cap under the floor, no trade in the last 24 hours, and pack
 * spend under the floor over 30 days. The Categories table lists them in a
 * collapsed group at its foot; their pages and rows stay, nothing is hidden.
 * Other, the catch-all, is never grouped. Client-safe.
 *
 * Oct 23 2026 (owner: "group the smaller IPs"): F1 ($515), VeeFriends ($30) and
 * Sneakers ($7) sat in the table with no trade and no pack sold. Lorcana's cap is
 * $241 too, but $358K of packs sold over 30 days keeps it in the main rows.
 */
import { formatCompactUsd } from "../format";

export const SMALL_IP_FLOOR_USD = 10_000;

/** The floor as the group's rule prints it: "$10K", not "$10.0K". */
export const SMALL_IP_FLOOR_LABEL = formatCompactUsd(SMALL_IP_FLOOR_USD).replace(/\.0(?=[KMB]$)/, "");

export function isSmallIp(ip: { key: string; mcapUsd: number; trades24h: number }, packs30dUsd?: number | null): boolean {
  if (ip.key === "other") return false;
  const cap = Number.isFinite(ip.mcapUsd) ? ip.mcapUsd : 0;
  const traded = Number.isFinite(ip.trades24h) && ip.trades24h > 0;
  const packs = packs30dUsd != null && Number.isFinite(packs30dUsd) ? packs30dUsd : 0;
  return cap < SMALL_IP_FLOOR_USD && !traded && packs < SMALL_IP_FLOOR_USD;
}
