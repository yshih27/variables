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

// ─────────────────────────── Credit meter ───────────────────────────
// Every Helius call is metered so a runaway crawl surfaces in check-freshness and
// trips a HARD per-run budget — instead of silently landing on the Helius bill (a
// dormant enhanced-tx warmer woke on the 7/1 key rotation and burned ~350K
// credits/day). The Enhanced Transactions REST API is the pricey path (~100× a DAS
// RPC call); weights are approximate but the ratio is what catches a burner.
const CREDIT_PER_CALL = { das: 1, enhanced: 100 } as const;
// Generous vs legit usage (holders ≈ 285 credits/run) but far under a runaway (the
// removed enhanced-tx crawl was ~500K/run) — so a re-introduced or accidental
// burner THROWS → runWarmer records an "error" → the health gate reddens. Tune with
// HELIUS_CREDIT_BUDGET (unset = the default; set a small value to stress-test).
const CREDIT_BUDGET = (() => {
  const raw = Number(process.env.HELIUS_CREDIT_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? raw : 250_000;
})();

let creditsUsed = 0;

/** Estimated Helius credits this process (≈ this warmer run) has spent. */
export function heliusCreditsUsed(): number {
  return creditsUsed;
}

function charge(kind: keyof typeof CREDIT_PER_CALL): void {
  creditsUsed += CREDIT_PER_CALL[kind];
  if (creditsUsed > CREDIT_BUDGET) {
    throw new Error(
      `Helius credit budget exceeded this run: ~${creditsUsed} > ${CREDIT_BUDGET} credits. ` +
        `A crawl is walking too far — bound it (since-cursor / page cap) or raise HELIUS_CREDIT_BUDGET.`,
    );
  }
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
  charge("das");
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
  charge("enhanced");
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
