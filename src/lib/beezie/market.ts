/**
 * Beezie native marketplace client — api.beezie.com/activity.
 *
 * Replaces the Rarible /activities/byCollection dependency for Beezie. Rarible's
 * shared request quota kept 429ing ("Request limit reached"), which dropped
 * Beezie's sales from the core-volume snapshot → the Pokémon IP (Beezie-heavy)
 * showed $0 recent volume. `/activity` is Beezie's OWN order feed:
 *   • order_fulfilled = a completed secondary SALE
 *   • order_created   = a listing
 *
 * Server-callable via node `fetch` (NOT curl — Beezie's WAF blocks curl's TLS
 * fingerprint; undici passes, same as the /claw warmer). Unauthenticated; needs a
 * browser UA + Origin/Referer. The feed reaches back months, so — unlike the old
 * 24h Rarible fetch — Beezie now gets real 7d/30d volume too.
 */
import type { NormalizedSale } from "../rarible/queries";

const BASE = "https://api.beezie.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Origin: "https://beezie.com",
  Referer: "https://beezie.com/",
  Accept: "application/json",
};
// The on-chain ERC-721 collection (Base). /activity rows carry this as tokenAddress.
const BEEZIE_CONTRACT = "0xbb5ec6fd4b61723bd45c399840f1d868840ca16f";
const REQUEST_TIMEOUT_MS = 30_000;
const backoffMs = (attempt: number) =>
  Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);

/** One row of /activity. Sales carry from/to (seller/buyer) + amount (USDC raw). */
type BeezieActivity = {
  type: string; // "order_fulfilled" (sale) | "order_created" (listing)
  createdAt: string; // "2026-06-29 06:35:22" (UTC, space-separated)
  categoryId: number;
  tokenId: number; // on-chain ERC-721 id — the beezie metadata-cache + image-CDN key
  amount: string; // USDC raw → /1e6
  tokenAddress?: string;
  from?: string; // seller (NFT sent from)
  to?: string; // buyer (NFT sent to)
  name?: string;
  imageUrl?: string;
  transactionHash?: string;
  isBurned?: unknown;
};

// Resilient like the phygitals client: a request timeout + backoff retries on
// 429/5xx AND network failures (the WAF sometimes stalls the socket vs 429ing).
async function fetchActivity(attempt = 0): Promise<BeezieActivity[]> {
  let res: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      res = await fetch(`${BASE}/activity`, { headers: HEADERS, cache: "no-store", signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, backoffMs(attempt)));
      return fetchActivity(attempt + 1);
    }
    throw err;
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await new Promise((r) => setTimeout(r, backoffMs(attempt)));
    return fetchActivity(attempt + 1);
  }
  if (!res.ok) throw new Error(`Beezie /activity ${res.status}`);
  const d = (await res.json()) as { activity?: BeezieActivity[] };
  return Array.isArray(d.activity) ? d.activity : [];
}

/** "2026-06-29 06:35:22" (UTC) → ISO. */
function beezieTimeToIso(s: string): string {
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Beezie secondary SALES (order_fulfilled) within `windowMs`, normalized to the
 * same shape as the Rarible/Dune paths so it's a drop-in for buildPlatform.
 * `tokenId` is the on-chain ERC-721 id (the key the beezie metadata cache + image
 * CDN use, so enrichSales resolves it); buyer = `to`, seller = `from`.
 */
export async function fetchBeezieSales(windowMs: number): Promise<NormalizedSale[]> {
  const events = await fetchActivity();
  const cutoff = Date.now() - windowMs;
  const out: NormalizedSale[] = [];
  for (const e of events) {
    if (e.type !== "order_fulfilled" || e.isBurned) continue;
    if (e.tokenAddress && e.tokenAddress.toLowerCase() !== BEEZIE_CONTRACT) continue;
    const priceUsd = Number(e.amount) / 1e6;
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;
    const date = beezieTimeToIso(e.createdAt);
    if (new Date(date).getTime() < cutoff) continue;
    out.push({
      date,
      tokenId: String(e.tokenId),
      buyer: String(e.to ?? ""),
      seller: String(e.from ?? ""),
      priceUsd,
    });
  }
  return out;
}
