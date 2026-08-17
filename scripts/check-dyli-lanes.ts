/**
 * DYLI lane-classifier regression check — pins `src/lib/dyli/lanes.ts` against
 * the channel shapes the feed actually emits. Sits beside check-freshness /
 * check-invariants / check-grade-parsing; exits non-zero on any failure so it
 * can gate.
 *
 *   npm run check-dyli-lanes
 *
 * Why this exists: DYLI's `market_type` says only primary/secondary, but
 * "primary" covers a mystery box, a raffle entry, a plain inventory purchase
 * and externally-hosted eBay stock. The lane decides which PUBLISHED number a
 * dollar lands in, so a silent reclassification moves marketplace / gacha /
 * direct totals without anything failing. Every case below is a shape observed
 * in the live feed on 2026-08-17, or an explicitly-agreed rule.
 */
import { classifyDyliLane, type DyliLane, type DyliSaleForLane } from "../src/lib/dyli/lanes";

type Case = [row: DyliSaleForLane, wantLane: DyliLane, wantUnknown: boolean, note: string];

const CASES: Case[] = [
  // ── Observed live rows (page 1 + page 2 of /sales, 2026-08-17) ──
  [
    { market_type: "primary", sale_channel: "box", source_marketplace: "dyli_box", price_usd: 1 },
    "gacha", false, "mystery box — item unknown at purchase",
  ],
  [
    { market_type: "primary", sale_channel: "fairdrop", source_marketplace: "dyli_fairdrop", price_usd: 1 },
    "direct", false, "fair-drop entry — ONE known prizeProduct (mechanics check 1a)",
  ],
  [
    { market_type: "primary", sale_channel: "primary", source_marketplace: "dyli_primary", price_usd: 48.99 },
    "direct", false, "plain inventory purchase of a known card",
  ],
  [
    { market_type: "secondary", sale_channel: "secondary", source_marketplace: "dyli_secondary_or_synced_secondary", price_usd: 110.55 },
    "marketplace", false, "user-to-user resale",
  ],

  // ── Agreed rules for channels documented but not seen in the sample ──
  [
    { market_type: "primary", sale_channel: "claim", source_marketplace: "dyli_box", price_usd: 0 },
    "excluded", false, "zero-price claim — the box order already counted the money",
  ],
  [
    { market_type: "primary", sale_channel: "claim", source_marketplace: "dyli_box", price_usd: 4.99 },
    "direct", false, "claim charging a fee — real incremental revenue",
  ],
  [
    { market_type: "primary", sale_channel: "ebay", source_marketplace: "ebay", price_usd: 150 },
    "excluded", false, "executed on eBay's venue, not DYLI custody (mechanics check 1b)",
  ],

  // ── The guard that matters most: anything unrecognised is NOT binned ──
  [
    { market_type: "primary", sale_channel: "auction", source_marketplace: "dyli_auction", price_usd: 25 },
    "excluded", true, "NEW channel → excluded AND flagged unknown, never folded into a lane",
  ],
  [
    { market_type: "external", sale_channel: "ebay", source_marketplace: "ebay", price_usd: 150 },
    "excluded", false, "market_type=external (the value /ebay/listings uses) still excludes",
  ],
  [
    { market_type: "primary", sale_channel: null, source_marketplace: null, price_usd: 10 },
    "excluded", true, "missing channel → unknown, not silently direct",
  ],
  [
    { market_type: null, sale_channel: undefined, source_marketplace: null, price_usd: null },
    "excluded", true, "entirely empty row → unknown",
  ],

  // ── Robustness: casing / whitespace must not change the lane ──
  [
    { market_type: "PRIMARY", sale_channel: " Box ", source_marketplace: "dyli_box", price_usd: 5 },
    "gacha", false, "case + whitespace tolerated",
  ],
  [
    { market_type: "Secondary", sale_channel: "secondary", source_marketplace: "x", price_usd: 5 },
    "marketplace", false, "secondary detected case-insensitively",
  ],
  // A secondary row whose channel disagrees still resolves as resale: market_type
  // is DYLI's own top-level resale flag and must win.
  [
    { market_type: "secondary", sale_channel: "box", source_marketplace: "dyli_box", price_usd: 5 },
    "marketplace", false, "market_type=secondary wins over an odd channel",
  ],
];

let failed = 0;
for (const [row, wantLane, wantUnknown, note] of CASES) {
  const got = classifyDyliLane(row);
  const ok = got.lane === wantLane && got.unknown === wantUnknown;
  if (!ok) {
    failed++;
    console.error(
      `✗ ${JSON.stringify(row)}\n    want lane=${wantLane} unknown=${wantUnknown}` +
        `\n    got  lane=${got.lane} unknown=${got.unknown} (${got.reason})\n    ${note}`,
    );
  } else {
    console.log(`✓ ${String(row.sale_channel ?? "—").padEnd(10)} → ${got.lane.padEnd(11)} ${note}`);
  }
}

// Every dollar must land somewhere deliberate: no lane may be silently dropped
// from the mapping as the classifier evolves.
const lanesCovered = new Set(CASES.map(([, l]) => l));
for (const lane of ["marketplace", "gacha", "direct", "excluded"] as DyliLane[]) {
  if (!lanesCovered.has(lane)) {
    failed++;
    console.error(`✗ no case covers lane "${lane}"`);
  }
}

console.log(`\n${CASES.length - failed}/${CASES.length} cases passed`);
if (failed) {
  console.error(`\n${failed} FAILED — the lane mapping moved. Confirm the channel's mechanics before changing the expectation.`);
  process.exit(1);
}
