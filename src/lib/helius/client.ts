/**
 * Helius client — thin wrapper around the DAS JSON-RPC and Enhanced
 * Transactions REST endpoints. All Solana data for tcg.market flows through
 * here.
 */
const RPC_URL = (key: string) => `https://mainnet.helius-rpc.com/?api-key=${key}`;
const ENHANCED_BASE = "https://api.helius.xyz/v0";

class HeliusError extends Error {
  constructor(public status: number, public body: string, public path: string) {
    super(`Helius ${status} on ${path}: ${body.slice(0, 200)}`);
  }
}

function apiKey(): string {
  const k = process.env.HELIUS_API_KEY;
  if (!k) throw new Error("HELIUS_API_KEY is not set");
  return k;
}

/**
 * Single retry with short backoff. We deliberately don't retry many times in
 * the request path because Server Components have a tight time budget; long
 * retries compound across paginated calls. The fail-soft handler upstream
 * falls back to history-only when this throws.
 */
async function withRetry<T>(fn: () => Promise<Response>, path: string, maxRetries = 1): Promise<T> {
  let attempt = 0;
  while (true) {
    const res = await fn();
    if (res.status === 429) {
      if (attempt >= maxRetries) {
        throw new HeliusError(429, await res.text(), path);
      }
      await new Promise((r) => setTimeout(r, 1000));
      attempt += 1;
      continue;
    }
    if (!res.ok) throw new HeliusError(res.status, await res.text(), path);
    return (await res.json()) as T;
  }
}

export async function dasCall<T>(method: string, params: unknown): Promise<T> {
  const body = await withRetry<{ result?: T; error?: { message: string } }>(
    () =>
      fetch(RPC_URL(apiKey()), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "1", method, params }),
        cache: "no-store",
      }),
    `RPC:${method}`,
  );
  if (body.error) throw new Error(`Helius RPC error: ${body.error.message}`);
  return body.result as T;
}

export async function enhancedGet<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${ENHANCED_BASE}${path}`);
  url.searchParams.set("api-key", apiKey());
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  return withRetry<T>(() => fetch(url.toString(), { cache: "no-store" }), path);
}

export { HeliusError };

// ─────────────────────────── Types ────────────────────────────
export type DasAsset = {
  id: string;
  interface: string;
  ownership: { owner: string };
  content?: {
    metadata?: {
      name?: string;
      attributes?: Array<{ trait_type: string; value: string | number }>;
    };
    files?: Array<{ uri?: string; cdn_uri?: string }>;
  };
  grouping?: Array<{ group_key: string; group_value: string }>;
};

export type DasGroupResponse = {
  total: number;
  limit: number;
  page: number;
  items: DasAsset[];
};

export type EnhancedTokenTransfer = {
  fromUserAccount: string | null;
  toUserAccount: string | null;
  tokenAmount: number;
  mint: string;
  tokenStandard?: string;
};

export type EnhancedTransaction = {
  signature: string;
  timestamp: number;
  type: string;
  source: string;
  fee: number;
  feePayer: string;
  description?: string;
  transactionError?: { error: string } | null;
  tokenTransfers: EnhancedTokenTransfer[];
  nativeTransfers?: Array<{ fromUserAccount: string; toUserAccount: string; amount: number }>;
};
