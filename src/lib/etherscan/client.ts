/**
 * Thin Etherscan-family v2 API client.
 *
 * Single endpoint supports all EVM chains via the `chainid` parameter:
 *   https://api.etherscan.io/v2/api?chainid=<id>&module=...&action=...
 *
 * No API key required for low-rate (~5 req / 5 sec) usage, but a key
 * unlocks 5 req/sec. Set ETHERSCAN_API_KEY in .env.local if you have one.
 *
 * Chains we care about:
 *   - 137  Polygon mainnet (Courtyard)
 *   - 8453 Base mainnet    (Beezie)
 */
const BASE_URL = "https://api.etherscan.io/v2/api";

class EtherscanError extends Error {
  constructor(public status: number, public body: string, public path: string) {
    super(`Etherscan ${status} on ${path}: ${body.slice(0, 200)}`);
  }
}

type EtherscanResponse<T> = {
  status: "0" | "1";
  message: string;
  /** "OK" or "No transactions found" or "Max calls per sec rate limit reached". */
  result: T | string;
};

export type TokenTransfer = {
  blockNumber: string;
  timeStamp: string; // unix seconds, as string
  hash: string;
  from: string;
  to: string;
  value: string; // raw amount, no decimals
  tokenDecimal: string;
  tokenSymbol: string;
  contractAddress: string;
};

/**
 * Polite throttler. Etherscan free tier = 1 req / 5 sec; with key = 5/sec.
 * We sleep between requests to stay inside the *no-key* budget by default
 * unless ETHERSCAN_API_KEY is set, in which case we sleep 200ms.
 */
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
const minDelayMs = () => (process.env.ETHERSCAN_API_KEY ? 220 : 5100);

let lastCallAt = 0;
async function throttle(): Promise<void> {
  const wait = minDelayMs() - (Date.now() - lastCallAt);
  if (wait > 0) await sleepMs(wait);
  lastCallAt = Date.now();
}

async function call<T>(params: Record<string, string | number>): Promise<T> {
  await throttle();
  const url = new URL(BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (process.env.ETHERSCAN_API_KEY) {
    url.searchParams.set("apikey", process.env.ETHERSCAN_API_KEY);
  }
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new EtherscanError(res.status, await res.text(), `${params.module}/${params.action}`);
  const body = (await res.json()) as EtherscanResponse<T>;
  if (body.status === "0") {
    // "No transactions found" is a valid empty result. Anything else is an error.
    if (typeof body.result === "string" && /no .* found/i.test(body.result)) {
      return [] as unknown as T;
    }
    if (typeof body.result === "string" && /rate limit/i.test(body.result)) {
      // Back off and retry once.
      await sleepMs(6000);
      return call(params);
    }
    throw new EtherscanError(200, `${body.message}: ${String(body.result).slice(0, 200)}`, `${params.module}/${params.action}`);
  }
  return body.result as T;
}

/**
 * ERC-20 token transfer history for an address.
 * Paginated. We return up to `pages * offset` transfers, most-recent first.
 *
 * For our use case we only need the last 7d — the inner loop stops paginating
 * once we cross the `sinceUnix` cutoff.
 */
export async function getTokenTransfers(opts: {
  chainId: number;
  address: string;
  contractAddress: string;
  sinceUnix: number;
  pageSize?: number;
  maxPages?: number;
}): Promise<TokenTransfer[]> {
  const pageSize = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 50;
  const out: TokenTransfer[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const transfers = await call<TokenTransfer[]>({
      chainid: opts.chainId,
      module: "account",
      action: "tokentx",
      contractaddress: opts.contractAddress,
      address: opts.address,
      page,
      offset: pageSize,
      sort: "desc",
    });
    if (!Array.isArray(transfers) || transfers.length === 0) break;
    let crossedCutoff = false;
    for (const tx of transfers) {
      const ts = Number(tx.timeStamp);
      if (ts < opts.sinceUnix) {
        crossedCutoff = true;
        break;
      }
      out.push(tx);
    }
    if (crossedCutoff || transfers.length < pageSize) break;
  }
  return out;
}

export { EtherscanError };
