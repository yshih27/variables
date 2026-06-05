/**
 * Read tokenURI(uint256) from an EVM ERC-721 contract via a public JSON-RPC.
 * No wallet, no SDK — just a raw eth_call decoded by hand.
 */

const SELECTOR_TOKEN_URI = "c87b56dd";

const RPCS: Record<"polygon" | "base", string[]> = {
  polygon: [
    "https://polygon-bor-rpc.publicnode.com",
    "https://polygon.drpc.org",
  ],
  base: [
    "https://base-rpc.publicnode.com",
    "https://mainnet.base.org",
    "https://base.llamarpc.com",
  ],
};

function tokenIdToHex(tokenId: string | bigint): string {
  const n = typeof tokenId === "bigint" ? tokenId : BigInt(tokenId);
  return n.toString(16).padStart(64, "0");
}

function decodeAbiString(hexResult: string): string {
  // ABI-encoded dynamic string: 32-byte offset, 32-byte length, then data.
  const data = hexResult.startsWith("0x") ? hexResult.slice(2) : hexResult;
  if (data.length < 128) return "";
  const length = parseInt(data.slice(64, 128), 16);
  if (!Number.isFinite(length) || length === 0) return "";
  const bytes = data.slice(128, 128 + length * 2);
  const buf = Buffer.from(bytes, "hex");
  return buf.toString("utf8");
}

async function rpcCall(rpcUrl: string, contract: string, data: string): Promise<string | null> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: contract, data: `0x${data}` }, "latest"],
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { result?: string; error?: unknown };
  if (!body.result) return null;
  return body.result;
}

/**
 * Resolve tokenURI for an ERC-721. Tries each RPC for the chain in order.
 */
export async function getTokenUri(
  chain: "polygon" | "base",
  contract: string,
  tokenId: string | bigint,
): Promise<string | null> {
  const data = `${SELECTOR_TOKEN_URI}${tokenIdToHex(tokenId)}`;
  for (const rpc of RPCS[chain]) {
    try {
      const result = await rpcCall(rpc, contract, data);
      if (result) {
        const uri = decodeAbiString(result);
        if (uri) return uri;
      }
    } catch {
      // try the next RPC
    }
  }
  return null;
}

export type TokenMetadata = {
  name?: string;
  description?: string;
  image?: string;
  /** Alternate image URL (e.g. CDN proxy when `image` is the raw gateway). */
  imageFallback?: string;
  external_url?: string;
  attributes?: Array<{ trait_type: string; value: string | number }>;
};

/**
 * Fetch metadata JSON with rate-limit handling.
 * On 429 (Cloudflare per-IP rate limit), back off and retry up to 3x.
 */
export async function fetchMetadataJson(
  uri: string,
  maxRetries = 3,
): Promise<TokenMetadata | null> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const res = await fetch(uri, {
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          accept: "application/json,text/plain,*/*",
          "accept-language": "en-US,en;q=0.9",
        },
      });
      if (res.status === 429) {
        // Cloudflare rate limit — back off and retry
        const waitMs = 2000 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, waitMs));
        attempt += 1;
        continue;
      }
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("json")) return null;
      return (await res.json()) as TokenMetadata;
    } catch {
      const waitMs = 1000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, waitMs));
      attempt += 1;
    }
  }
  return null;
}

export async function getTokenMetadata(
  chain: "polygon" | "base",
  contract: string,
  tokenId: string | bigint,
): Promise<TokenMetadata | null> {
  const uri = await getTokenUri(chain, contract, tokenId);
  if (!uri) return null;
  return fetchMetadataJson(uri);
}
