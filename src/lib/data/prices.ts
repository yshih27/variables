/**
 * Spot price oracle. Used to convert raw `take.value` from Rarible orders
 * (denominated in ETH / MATIC / WETH / etc) to USD.
 *
 * Free source: CoinGecko `/simple/price`. No auth, ~30 req/min limit which
 * is plenty since we only need a handful of currencies and we cache.
 */

const COIN_GECKO = "https://api.coingecko.com/api/v3/simple/price";

// Map currency contract (lowercased) → CoinGecko id.
// Native "ETH"/"MATIC" types use a sentinel key.
const CURRENCY_ID: Record<string, string> = {
  // Native chain currencies
  "native:polygon": "matic-network",
  "native:base": "ethereum",
  "native:ethereum": "ethereum",

  // USDC variants → 1:1 USD (return 1.0 directly, no CoinGecko call)
  "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": "_usd", // USDC Polygon
  "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": "_usd", // USDT Polygon
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": "_usd", // USDC.e Polygon
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "_usd", // USDC Base
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": "_usd", // USDbC Base
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "_usd", // USDC ETH mainnet

  // WETH variants → ethereum price
  "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": "ethereum", // WETH Polygon
  "0x4200000000000000000000000000000000000006": "ethereum", // WETH Base
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "ethereum", // WETH ETH mainnet

  // WMATIC / wrapped MATIC
  "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270": "matic-network", // WMATIC Polygon
};

// One fetch per process lifetime — scripts can run for hours, and we don't
// want to refresh prices mid-run (especially against CoinGecko's free tier,
// which throttles aggressively).
let cached: { rates: Record<string, number>; at: number } | null = null;

export async function getSpotRates(): Promise<Record<string, number>> {
  if (cached) return cached.rates;
  const ids = Array.from(new Set(Object.values(CURRENCY_ID).filter((id) => id !== "_usd")));
  const url = `${COIN_GECKO}?ids=${ids.join(",")}&vs_currencies=usd`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const body = (await res.json()) as Record<string, { usd: number }>;
  const rates: Record<string, number> = { _usd: 1 };
  for (const id of ids) rates[id] = body[id]?.usd ?? NaN;
  cached = { rates, at: Date.now() };
  return rates;
}

export type RaribleAssetType =
  | { "@type": "ERC20"; contract: string }
  | { "@type": "ETH" }
  | { "@type": "CURRENCY"; contract: string }
  | { "@type": string; contract?: string };

/**
 * Convert a raw take.value (decimal string) for a currency type to USD.
 * Returns null when currency is unrecognized or rate is missing.
 */
export async function toUsd(
  rawValue: string,
  type: RaribleAssetType,
  chainHint: "polygon" | "base" | "ethereum",
): Promise<number | null> {
  const value = parseFloat(rawValue);
  if (!Number.isFinite(value)) return null;

  let key: string | null = null;
  if (type["@type"] === "ETH") {
    key = `native:${chainHint}`;
  } else if (type["@type"] === "ERC20" || type["@type"] === "CURRENCY") {
    const contract = (type.contract ?? "").toLowerCase().replace(/^[a-z]+:/, "");
    if (contract) key = contract;
  }
  if (!key) return null;

  const cgId = CURRENCY_ID[key];
  if (!cgId) return null;
  if (cgId === "_usd") return value; // stablecoin

  const rates = await getSpotRates();
  const rate = rates[cgId];
  if (!Number.isFinite(rate)) return null;
  return value * rate;
}

// ─────────────────────────── Benchmark price history ───────────────────────────

/**
 * Daily market-chart for a CoinGecko coin id (free, no key) — extends the
 * CoinGecko integration above for the indices engine's benchmarks. Returns the
 * raw `[msTimestamp, priceUsd][]` series; for `days > 90` CoinGecko returns daily
 * granularity. The benchmarks warmer buckets these to one close per UTC day.
 */
export async function fetchCoinGeckoMarketChart(
  id: string,
  days = 365,
): Promise<[number, number][]> {
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`CoinGecko market_chart ${res.status} for ${id}`);
  const body = (await res.json()) as { prices?: [number, number][] };
  return body.prices ?? [];
}
