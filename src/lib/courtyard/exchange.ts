/**
 * Courtyard's own marketplace, read from Polygon.
 *
 * A trade on courtyard.io settles non-custodially on Polygon: the exchange emits
 * `TradeExecuted(address indexed bidder, address indexed asker, uint256 indexed
 * nftTokenId, address erc20Token, uint256 amount, bytes tradeSignature, uint256
 * feeAccrued)`, and native USDC moves bidder → exchange → asker in the same
 * transaction (relayed, gasless). Two operators carry it.
 *
 * ⚠️ TWO DIFFERENT THINGS SETTLE THROUGH THE SAME EVENT.
 * - **Buyback:** the bidder is Courtyard's operations wallet, buying a pulled
 *   card back from the player. That is gacha economics (USDC out to players),
 *   never resale.
 * - **Peer-to-peer:** every other bidder. That is Courtyard's secondary market.
 * Measured Oct 13 (dune/coverage-courtyard-marketplace.sql), 30 days to Oct 12:
 * 157,650 peer-to-peer trades, $8.38M; 1,171,752 buybacks, $57.59M. Until this
 * feed, Varible read Courtyard resale from OpenSea trades only (Rarible's
 * activity index): a few dollars a day.
 *
 * Read through a public Polygon RPC, 5,000 blocks (~2 hours) a request; the
 * response carries `blockTimestamp`. Measured Oct 13: 2,690 trades in one
 * 5,000-block request, 4.9 s. Other public endpoints refuse (publicnode treats
 * the range as archive, drpc caps the free range, 1rpc allows 50 blocks).
 */

export const COURTYARD_EXCHANGES = [
  "0x5e4943373c2198625bd441ae0629e9e7b4fb4797",
  "0x7fbf08a0ed3ef12565a61935ca6339bbecc25f48",
] as const;

/** keccak256("TradeExecuted(address,address,uint256,address,uint256,bytes,uint256)") */
export const TRADE_EXECUTED_TOPIC0 = "0xa6ae807740439025f50884311ce0f96f5c3809a8f7170f9459dab1b14c9d8afd";

/** Courtyard's operations wallet: the bidder on every gacha buyback. */
export const COURTYARD_OPS_WALLET = "0x66dbff2ce099d19b4e8c5dc8b254ec7aeaf5e642";

/** Native USDC on Polygon (6 decimals): the only settlement token counted. */
export const POLYGON_USDC = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";

export const POLYGON_LOG_RPCS = ["https://rpc-mainnet.matic.quiknode.pro"] as const;

/** Blocks per eth_getLogs request (~2 hours on Polygon). */
export const LOG_CHUNK_BLOCKS = 5_000;

export type ExchangeTradeKind = "buyback" | "p2p";

export type ExchangeTrade = {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  /** Block time, ISO UTC. */
  ts: string;
  bidder: string;
  asker: string;
  /** Decimal token id in the Courtyard registry. */
  tokenId: string;
  usd: number;
  kind: ExchangeTradeKind;
};

export type RawLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  blockTimestamp?: string;
  removed?: boolean;
};

const addrOfTopic = (t: string | undefined) => (t && t.length >= 66 ? `0x${t.slice(-40)}`.toLowerCase() : null);
const word = (data: string, i: number) => data.slice(2 + 64 * i, 2 + 64 * (i + 1));

/**
 * One raw log → a trade, or null when it is not a USDC trade on a Courtyard
 * exchange (another token, a removed log, a malformed payload). Pure.
 */
export function decodeTradeLog(log: RawLog): ExchangeTrade | null {
  if (log.removed) return null;
  if (!COURTYARD_EXCHANGES.includes(log.address.toLowerCase() as (typeof COURTYARD_EXCHANGES)[number])) return null;
  if ((log.topics[0] ?? "").toLowerCase() !== TRADE_EXECUTED_TOPIC0) return null;
  const bidder = addrOfTopic(log.topics[1]);
  const asker = addrOfTopic(log.topics[2]);
  const tokenTopic = log.topics[3];
  if (!bidder || !asker || !tokenTopic) return null;
  if (!/^0x[0-9a-fA-F]*$/.test(log.data) || log.data.length < 2 + 64 * 2) return null;
  const token = `0x${word(log.data, 0).slice(-40)}`.toLowerCase();
  if (token !== POLYGON_USDC) return null;
  const amount = BigInt(`0x${word(log.data, 1)}`);
  const usd = Number(amount) / 1e6;
  if (!(usd > 0) || !log.blockTimestamp) return null;
  return {
    txHash: log.transactionHash.toLowerCase(),
    logIndex: parseInt(log.logIndex, 16),
    blockNumber: parseInt(log.blockNumber, 16),
    ts: new Date(parseInt(log.blockTimestamp, 16) * 1000).toISOString(),
    bidder,
    asker,
    tokenId: BigInt(tokenTopic).toString(),
    usd,
    kind: bidder === COURTYARD_OPS_WALLET ? "buyback" : "p2p",
  };
}

type RpcOpts = { rpcs?: readonly string[]; fetchImpl?: typeof fetch };

async function rpc<T>(method: string, params: unknown[], opts: RpcOpts = {}): Promise<T> {
  const f = opts.fetchImpl ?? fetch;
  let last = "no endpoint answered";
  for (const url of opts.rpcs ?? POLYGON_LOG_RPCS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await f(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(30_000),
        });
        const j = (await res.json()) as { result?: T; error?: { message?: string } };
        if (j.error) throw new Error(j.error.message ?? JSON.stringify(j.error));
        if (j.result === undefined) throw new Error("empty result");
        return j.result;
      } catch (e) {
        last = `${url}: ${(e as Error).message}`;
        await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
      }
    }
  }
  throw new Error(`polygon ${method} failed: ${last}`);
}

/** The newest block, less a margin for reorgs. */
export async function polygonSafeTip(opts: RpcOpts & { margin?: number } = {}): Promise<number> {
  return parseInt(await rpc<string>("eth_blockNumber", [], opts), 16) - (opts.margin ?? 64);
}

/** A block's time in ms. */
export async function blockTimeMs(block: number, opts: RpcOpts = {}): Promise<number> {
  const b = await rpc<{ timestamp: string }>("eth_getBlockByNumber", [`0x${block.toString(16)}`, false], opts);
  return parseInt(b.timestamp, 16) * 1000;
}

/** The first block at or after `ms`, by binary search over block times (~25 header reads). */
export async function blockAtOrAfter(ms: number, opts: RpcOpts = {}): Promise<number> {
  let lo = 1;
  let hi = await polygonSafeTip({ ...opts, margin: 0 });
  if ((await blockTimeMs(hi, opts)) < ms) return hi + 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await blockTimeMs(mid, opts)) < ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Every USDC trade on the two exchanges in [fromBlock, toBlock], chunked.
 * Throws when a chunk cannot be read: a partial read must never be stored as a
 * quiet stretch.
 */
export async function fetchExchangeTrades(
  fromBlock: number,
  toBlock: number,
  opts: RpcOpts & { chunk?: number; onChunk?: (done: number, total: number, trades: number) => void } = {},
): Promise<ExchangeTrade[]> {
  const chunk = opts.chunk ?? LOG_CHUNK_BLOCKS;
  const out: ExchangeTrade[] = [];
  const total = Math.max(0, Math.ceil((toBlock - fromBlock + 1) / chunk));
  let done = 0;
  for (let a = fromBlock; a <= toBlock; a += chunk) {
    const b = Math.min(toBlock, a + chunk - 1);
    const logs = await rpc<RawLog[]>(
      "eth_getLogs",
      [{ fromBlock: `0x${a.toString(16)}`, toBlock: `0x${b.toString(16)}`, address: [...COURTYARD_EXCHANGES], topics: [TRADE_EXECUTED_TOPIC0] }],
      opts,
    );
    for (const l of logs) {
      const t = decodeTradeLog(l);
      if (t) out.push(t);
    }
    done++;
    opts.onChunk?.(done, total, out.length);
  }
  return out;
}
