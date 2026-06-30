import type { Chain } from "@/lib/types";

/**
 * Canonical platform definitions for v1.
 * Verified contract IDs / Solana mint addresses (do not search; do not auto-discover).
 *
 * Each platform has up to three on-chain footprints:
 *
 *   1. **Collection** — the NFT contract / Solana collection mint whose tokens
 *      represent the cards. Used for trait + ownership reads.
 *
 *   2. **Marketplace** — the contract/program where secondary trading happens
 *      *natively* on the platform. We use this to capture sales that don't
 *      route through Rarible/OpenSea aggregators. Optional today: when absent
 *      we fall back to the aggregator data for secondary volume.
 *
 *   3. **Primary** — wallets that receive money (USDC) when a user opens a
 *      gacha pack / tokenizes a card. Inflows to these wallets = primary
 *      revenue. Outflows back to non-treasury wallets = buyback.
 *
 *      Methodology (from the team's Dune queries):
 *        primary_revenue = Σ(USDC inflow to `primary.receivers` from
 *                            wallets NOT in `primary.internalExclusions`)
 *        For CC: filter to valid pull-price buckets only.
 *        For Courtyard / Phygitals: count all inflows; the fee-split
 *        (6% bb_fees vs 94% buyback) is computed downstream from the
 *        marketplace contract flow.
 */
export type PrimaryWalletConfig = {
  /** Wallets that receive primary-market currency (gacha pulls, tokenization fees). */
  receivers: string[];
  /**
   * Wallets to EXCLUDE as senders. These are internal/treasury, transfers
   * from them to receivers are house moves (not user revenue).
   */
  internalExclusions: string[];
  /** ERC-20 contract address (EVM) or SPL mint address (Solana) for the counted currency. */
  currencyAddress: string;
  /** Currency decimals — USDC = 6. */
  currencyDecimals: number;
  /**
   * Optional whitelist of valid amount buckets. If set, only count transfers
   * whose amount (in human units) matches one of these values exactly.
   * Used by Collector Crypt to filter to known pull prices.
   * Empty / undefined = count all amounts.
   */
  validAmounts?: number[];
};

export type PlatformSource = {
  key: "courtyard" | "beezie" | "collector-crypt" | "phygitals";
  name: string;
  short: string;
  chain: Chain;
  vault: string | null;
  /** Native secondary-marketplace contract (EVM) or program (Solana). Optional. */
  marketplace?: string;
  /** Native primary-revenue wallet config. Optional. */
  primary?: PrimaryWalletConfig;
} & (
  | { kind: "rarible"; collectionId: string }
  | {
      kind: "helius";
      collectionAddress: string;
      /**
       * Extra collection mints for platforms whose cards span more than one
       * collection (e.g. Phygitals' two cNFT trees). Scanned alongside
       * `collectionAddress` for holder/trait reads.
       */
      extraCollections?: string[];
      marketplaceProgram: string;
    }
);

// ─── EVM USDC contracts ────────────────────────────────────────────────
const USDC_POLYGON = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // native USDC on Base

// ─── Solana SPL USDC mint ─────────────────────────────────────────────
const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// ─── Beezie "The Claw" gacha contract (Base) ──────────────────────────
// Verified from pull tx 0xc9650f8f…9c55d: user → Claw (50 USDC) → operator
// (0x406762fC…f1813F173). We measure pull revenue as USDC inflow TO the Claw,
// so the operator forward (an OUTflow from the Claw) is never miscounted and
// needs no exclusion.
const BEEZIE_CLAW = "0x964E72Ae6BE07a191bE1778DbC52457272a53154";

// ─── Courtyard primary-revenue wallets (Polygon) ──────────────────────
// 20 gacha-spend wallets that receive USDC for tokenization/pack fees.
const COURTYARD_PRIMARY_RECEIVERS: string[] = [
  "0xedf073581267d82b6e4fd63b5fb288f1876555cd",
  "0x5e9e7841198c34bad39c7344c6e2829ebf39b8b3",
  "0xda92c437e599b2c973229ca2ae5fb17ec2cf04a9",
  "0x92714d4827fa2e396d9f753976cc8a3d395b8064",
  "0x5556bc8e4c6482e39197425e96e9fb5ef5ba05d2",
  "0x7fc1afb29861fd4a7dfb7859b5271d3c75e4abbd",
  "0x4cd41debc6d038317379df1d059938894362ef7f",
  "0x13e7cdcabce0fca98df4eb5d34619144d45b6b76",
  "0x43f1c23fbf8e3fb964a1337b1e697f04f7e38a5c",
  "0x7ee9f40d48f4e58dc9f21fbd2335c4f2ec1f3d78",
  "0x33d39c79582704fc3fae79e818889cacb8cf5e6c",
  "0x0fc3f443d73d10866d1dff51af4d9f5a31ba2ffc",
  "0x554ad79f0c9d512b624b9bfc2e1ffd4cf50cf220",
  "0x0af477ac793c3ee69bfcad83e148add148705d79",
  "0x5a09ed135b1a9c5bf1a66084d4597d4e9f29ceb1",
  "0xa0e6cb4c42f0fe31846c48f2693bfe879bc10534",
  "0xfaad7036e8b4f8d5613023476485e49d1eafa044",
  "0x29804859dbe973e844c643654269f1e16e546720",
  "0xa695dfa7a885ffaafce414ded322d18ea3f24679",
  "0x31d058b5e02c8b01c749e6844d86cdd3f2962cd7",
  "0x776023a4573bd972c4c3e2a76f611d3c2bef516e",
];

// ─── Collector Crypt primary-revenue wallets (Solana) ─────────────────
// 3 gacha receivers; the fees/royalty wallet is tracked separately.
const CC_PRIMARY_RECEIVERS: string[] = [
  "GachazZscHZ5bn3vnq1yEC4zpYdhAYJBzuKJwSJksc9z",
  "GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3",
  "96DULv1BqYfe5wyMr6pVUNC6Uyrtj6yr3tNi6VtfwW9s",
];
/**
 * CC internal-treasury wallets that we EXCLUDE as senders so we don't
 * double-count internal house moves. Sourced from the team's Dune query
 * — these are rarity buckets (Epic, High, Mid, Low, LGND, SPrT) plus the
 * core treasury wallets.
 */
const CC_INTERNAL_EXCLUSIONS: string[] = [
  "BAxTk97HsaJqbnbFmTiQTaL4KSRvJ8Y65ArZCsP6vA5M",
  "21KhtC7y2JGYvwc8dcGqTdbrudbM8fgMPJsVwxRQqdY8",
  "DFEstpYN3fsz93AC9v2ujzPPngPgodqH2xxopuyfSsAE",
  "HW2HRqN1pXQGH9GfP9xet4XwqtLqFyYGDNRKjUAVgh9u",
  "HighJBfnAaqH9cKkeMErQFJZ4ATxQJwxqFupX6zaKTns",
  "LGNDXqcm6U57QQ6Ad7icZ6oizkAVKRWrw97KwZy5nVf",
  "EpicWWZspT1trKndbDDr29ULViN56rN5vofWSKZp8ePF",
  "Mid9NeCpPNxP59fAdsLgMLy7BYexxXFw52ZP58Jrney",
  "Lowq9dkpY43VpjfYeRjtKfGA6JtB7HaMmwQgXkjHLvN",
  "Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu",
  "miDtj3vgdxVykHzRyFwyG8MXpvK8eQqamSLVdBr7WPt",
  "HiGHqwYddP5N2waqUmXPdaASpMpUEvfqPr2fSawctEb",
  "epiC3zkqa1RfcPMMM1Kc8m3GZGDwF2RmjbfA3g1BBjn",
  "LGNDfXQFMiRMz3qqTNAREmRFQutMvazqqRrzn5i98uj",
  "SPrT7eFrCM9UJ4j7Xf9iktKCoBwJjfykFbiNbRsKQm8",
];
/** CC gacha valid pull prices in USDC — the full /api/gachas/all catalog (re-sync
 *  when CC adds packs). 151 = Rarible×CC "151 & Friends" (pokemon_151); 2500/5000
 *  = Mythic/Celestial. These were missing → CC gacha + primary revenue undercounted.
 *  Durable fix (TODO): derive from the live catalog instead of hardcoding. */
const CC_VALID_PULL_PRICES: number[] = [25, 50, 75, 80, 100, 151, 250, 1000, 2500, 5000];

// ─── Phygitals primary-revenue wallets (Solana) ───────────────────────
// Main gacha wallet + secondary gacha wallet + fee streams.
const PHYGITALS_PRIMARY_RECEIVERS: string[] = [
  "62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS", // main gacha spend
  "42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e", // gacha spend (alt)
  "4SabGkbLc9uxzrq4f1Es9tJPZfHVzP28kwSosR2sYJRt", // luckydraw fees
  "2CEe9G68EqWmer21DhRhxJ3coUvRspDxT9NJuc2PJYo5", // royalties
];
const PHYGITALS_INTERNAL_EXCLUSIONS: string[] = [
  "5sn2nniGv88bxzxBDkqWP6i8bejsr9WwCpZXq2ZkLHgf", // treasury
];

// ─── Phygitals collection mints (Solana cNFT) ─────────────────────────
// Two compressed-NFT collection trees. Verified-by-use: the marketplace
// listings endpoint (api.phygitals.com/marketplace-listings) returns real
// Phygitals cards only when filtered to exactly these collectionAddresses.
// Drive holder + trait reads via Helius DAS. Re-exported by the Phygitals
// marketplace client so there's one source of truth.
export const PHYGITALS_COLLECTIONS = [
  "BSG6DyEihFFtfvxtL9mKYsvTwiZXB1rq5gARMTJC2xAM",
  "phygZDQZJZVHvJGYPGoKPYUtXw7mstSYtTtcuh8LJcC",
];

// ──────────────────────────────────────────────────────────────────────

export const PLATFORM_SOURCES: PlatformSource[] = [
  {
    key: "courtyard",
    name: "Courtyard",
    short: "C",
    chain: "Polygon",
    vault: "Brink's",
    kind: "rarible",
    collectionId: "POLYGON:0x251be3a17af4892035c37ebf5890f4a4d889dcad",
    marketplace: "0x5E4943373c2198625BD441Ae0629E9E7b4FB4797",
    primary: {
      receivers: COURTYARD_PRIMARY_RECEIVERS,
      internalExclusions: [],
      currencyAddress: USDC_POLYGON,
      currencyDecimals: 6,
    },
  },
  {
    key: "beezie",
    name: "Beezie",
    short: "B",
    chain: "Base",
    vault: "Brink's",
    kind: "rarible",
    collectionId: "BASE:0xbb5ec6fd4b61723bd45c399840f1d868840ca16f",
    // Native Base marketplace. Replaces Rarible aggregator dependency over time.
    marketplace: "0x80d7C04B738eF379971a6b73f25B1A71ea1c820D",
    // NOTE: Beezie also runs a Flow EVM marketplace at
    //   0xf0FE19923767dC6e34f9890Bd6020002231ef386
    // Not tracked in v1 — add when we cover Flow.
    primary: {
      // "The Claw" gacha. Pull revenue = USDC inflow to the Claw contract.
      // validAmounts left open until we confirm the full tier ladder from the
      // data (a $50 pull is verified; others likely exist).
      receivers: [BEEZIE_CLAW],
      internalExclusions: [],
      currencyAddress: USDC_BASE,
      currencyDecimals: 6,
    },
  },
  {
    key: "collector-crypt",
    name: "Collector Crypt",
    short: "CC",
    chain: "Solana",
    vault: "PWCC",
    kind: "helius",
    collectionAddress: "CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf",
    marketplaceProgram: "CcmRKTuZCGJBWQwMHvDYApBRvSZNHqGJXkznqpDTSQUr",
    primary: {
      receivers: CC_PRIMARY_RECEIVERS,
      internalExclusions: CC_INTERNAL_EXCLUSIONS,
      currencyAddress: USDC_SOLANA,
      currencyDecimals: 6,
      validAmounts: CC_VALID_PULL_PRICES,
    },
  },
  {
    key: "phygitals",
    name: "Phygitals",
    short: "PH",
    chain: "Solana",
    vault: null, // unverified vault provider; surface as "—" until confirmed
    kind: "helius",
    // Two cNFT collections (verified-by-use via the marketplace listings API).
    // Both are scanned for holders + traits via Helius DAS.
    collectionAddress: PHYGITALS_COLLECTIONS[0],
    extraCollections: PHYGITALS_COLLECTIONS.slice(1),
    // Secondary-sale VOLUME is NOT a single native program here: Phygitals
    // listings aggregate Tensor + Magic Eden + native. Like CC's 7675297, it
    // needs a Dune query anchored on the collection mints above, feeding
    // `core-volume`. Pending that query, secondary stats render empty (honestly
    // absent — not a fabricated $0). marketplaceProgram stays "" (unused today).
    marketplaceProgram: "",
    primary: {
      receivers: PHYGITALS_PRIMARY_RECEIVERS,
      internalExclusions: PHYGITALS_INTERNAL_EXCLUSIONS,
      currencyAddress: USDC_SOLANA,
      currencyDecimals: 6,
    },
  },
];
