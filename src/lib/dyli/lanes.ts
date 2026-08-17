/**
 * DYLI channel → volume-lane classifier.
 *
 * DYLI's `market_type` is only two values (primary / secondary), but "primary"
 * covers four genuinely different things — a mystery box, a raffle entry, a
 * plain inventory purchase, and externally-hosted eBay stock. Binning them all
 * into one lane would publish an inventory purchase as a "pack rip", which is
 * the mislabeling class the launch audit exists to prevent (see the Courtyard
 * tokenization-as-gacha regression). So the lane is decided by `sale_channel`,
 * not `market_type`, and every branch below cites the evidence for its call.
 *
 * Lanes map onto the site's existing three-lane volume model (see
 * src/lib/metrics/glossary.ts): marketplace resale + gacha + direct sales.
 */

/** Which published volume lane a DYLI sale row belongs to. */
export type DyliLane =
  /** Secondary resale → `volume_usd` (the marketplace lane). */
  | "marketplace"
  /** Random-outcome first sale → `gacha_volume_usd`. */
  | "gacha"
  /** Non-gacha first sale → `direct_volume_usd` (the "Direct sales" lane). */
  | "direct"
  /** Deliberately outside DYLI's platform volume. Stored, never published. */
  | "excluded";

export type DyliLaneVerdict = {
  lane: DyliLane;
  /** Why — carried into logs so an exclusion is never silent. */
  reason: string;
  /** True when the row's channel is one we have no rule for (see below). */
  unknown: boolean;
};

/** The channel values DYLI documents in /overview field_reference. */
export const KNOWN_DYLI_CHANNELS = ["primary", "secondary", "fairdrop", "box", "ebay", "claim"] as const;

export type DyliSaleForLane = {
  market_type?: string | null;
  sale_channel?: string | null;
  source_marketplace?: string | null;
  price_usd?: number | null;
};

/**
 * Classify one sale row. Pure — no I/O — so the gate in
 * scripts/check-dyli-lanes.ts can pin every branch.
 */
export function classifyDyliLane(row: DyliSaleForLane): DyliLaneVerdict {
  const marketType = (row.market_type ?? "").trim().toLowerCase();
  const channel = (row.sale_channel ?? "").trim().toLowerCase();
  const price = Number(row.price_usd);

  // ── secondary → marketplace ──────────────────────────────────────────────
  // A user bought from another user's listing (or an accepted offer). This is
  // resale, i.e. the marketplace lane. Keyed on market_type because that is
  // DYLI's own top-level "first sale vs resale" bucket; the channel agrees
  // (every observed secondary row carries sale_channel=secondary and
  // source_marketplace=dyli_secondary_or_synced_secondary).
  if (marketType === "secondary" || channel === "secondary") {
    return { lane: "marketplace", reason: "secondary resale", unknown: false };
  }

  switch (channel) {
    // ── box → gacha ────────────────────────────────────────────────────────
    // A mystery box: the buyer pays before knowing which item they receive.
    // That is a pack rip in this codebase's vocabulary, so it belongs in the
    // gacha lane. Confirmed by the box endpoints (/boxes/{id}/ranges exposes
    // the outcome ranges) and by the sales rows' lifecycle.buyback fields,
    // which only exist because a box result can resolve to a buyback.
    case "box":
      return { lane: "gacha", reason: "mystery box (unknown item at purchase)", unknown: false };

    // ── fairdrop → direct ──────────────────────────────────────────────────
    // MECHANICS CHECK (2026-08-17, GET /fair-drops): a Fair Drop sells a fixed
    // -price entry (entryPricing.price, e.g. $1) toward a SINGLE named
    // `prizeProduct` — one productId/tokenId, not a prize table. Fields are
    // minimumEntries / maxEntries / entriesRemaining / winnerUsername: the RNG
    // decides WHO gets to own that one known item, never WHAT the item is.
    // Per the agreed rule (known item → Direct), this is a direct first sale,
    // not a pack rip. If DYLI ever ships multi-item prize tables, this branch
    // must move to "gacha".
    case "fairdrop":
      return { lane: "direct", reason: "fair-drop entry for one known prizeProduct", unknown: false };

    // ── plain primary → direct ─────────────────────────────────────────────
    // Standard checkout against DYLI-held inventory: the buyer picks a specific
    // known card. A first sale, but not a random outcome — exactly the
    // glossary's "Direct sales: non-gacha first sales".
    case "primary":
      return { lane: "direct", reason: "inventory purchase of a known item", unknown: false };

    // ── claim → excluded when free, direct when it charges ─────────────────
    // A claim resolves an already-paid box win into a delivered item. The money
    // was already counted on the box row, so a zero-price claim must not be
    // counted again. A claim that does charge (a fee) is real incremental
    // revenue and lands in the direct lane.
    case "claim":
      return Number.isFinite(price) && price > 0
        ? { lane: "direct", reason: "claim with a nonzero fee", unknown: false }
        : { lane: "excluded", reason: "zero-price claim (box win already counted)", unknown: false };

    // ── ebay → excluded ────────────────────────────────────────────────────
    // MECHANICS CHECK (2026-08-17, GET /ebay/listings): these rows are eBay's
    // own inventory surfaced inside DYLI's catalog — `market_type: "external"`,
    // `seller: "psa"`, `vault_provider: "psa_vault"`, and `purchase.status:
    // "coming_soon"` (buying through DYLI is not live). The venue is eBay, not
    // DYLI custody, so it is not DYLI platform volume.
    // ⚠️ DYLI does NOT filter these out for us: /sales echoes
    // `excluded_marketplaces: []`. (The `listings_exclude_marketplaces:
    // ["eBay"]` in /overview applies to /listings, not /sales.) The exclusion
    // has to happen here.
    case "ebay":
      return { lane: "excluded", reason: "executed on eBay's venue, not DYLI custody", unknown: false };

    // ── anything else → excluded, and say so ───────────────────────────────
    // A channel we have no rule for must never be silently folded into a lane:
    // that is how a new revenue surface quietly inflates or deflates a
    // published number. The warmer counts these and fails the run so the health
    // gate reddens and someone classifies it deliberately.
    default:
      return {
        lane: "excluded",
        reason: `unrecognised sale_channel "${row.sale_channel ?? ""}" (market_type "${row.market_type ?? ""}", source "${row.source_marketplace ?? ""}")`,
        unknown: true,
      };
  }
}

/** Lane → the spine metric it accumulates into. `excluded` publishes nowhere. */
export const LANE_METRIC: Record<Exclude<DyliLane, "excluded">, string> = {
  marketplace: "volume_usd",
  gacha: "gacha_volume_usd",
  direct: "direct_volume_usd",
};
