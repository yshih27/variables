/**
 * THE HOLDINGS — what one address holds in the collections we track, read from
 * the chain's indexers, budgeted, metered, and honest about what it did not read.
 *
 *   • Solana (Collector Crypt, Phygitals' two cNFT trees): Helius DAS
 *     `searchAssets` with `ownerAddress` + `grouping: ["collection", <mint>]`,
 *     one query per tracked collection, 1,000 a page. Owner and metadata ride
 *     inline, so a slab the weekly trait crawl has not reached still has a name
 *     and attributes. Every page goes through `dasCall`, which charges the same
 *     credit meter the warmers do.
 *   • EVM (Courtyard on Polygon, Beezie on Base): an INDEX finds candidates,
 *     the CHAIN decides — one Multicall3 `ownerOf` per leg (onchain/ownerOf.ts)
 *     keeps only the tokens the address owns right now.
 *
 *     ⚠️ WHICH INDEX, PER VENUE, MEASURED 2026-09-24 against the on-chain owners
 *     of every candidate any source proposed (recall = owned tokens found):
 *
 *                              Rarible search   Rarible byOwner   Blockscout
 *       Beezie  (Base)  A          1 / 65           5 / 65         65 / 65
 *       Beezie  (Base)  B          0 / 2            0 / 2           2 / 2
 *       Courtyard (Polygon) ×2    74 / 74          74 / 74         74 / 74
 *
 *     Rarible's Base ownership index is not usable for Beezie: it misses
 *     transfers out of Beezie's contract (`bulkTransferFrom` to its buyback
 *     wallets) and its `batchBurnEmergency` redemptions, so it names owners
 *     for tokens that moved or no longer exist. Beezie therefore reads
 *     Blockscout's per-address NFT list (keyless, and it carries each token's
 *     metadata, so a slab with no card row still has a name). Courtyard stays
 *     on Rarible `POST /items/search`, which filters by owner AND collection
 *     server-side — ⚠️ not `items/byOwner`, which ignores a `collections`
 *     filter (a 1,000-item page came back spanning 10 Polygon collections).
 *     Blockscout carries stale owners too (it listed burned tokens as held),
 *     which is why no index is trusted without the `ownerOf` check.
 *
 *     Tokens the chain says are burned or owned elsewhere are dropped and
 *     counted per leg; if no RPC answers, the candidates are kept with
 *     `ownerVerified: false` and the result is `partial` (`owner-unverified`).
 *
 * The collections come from `PLATFORM_SOURCES` — the one registry — by chain.
 *
 * ⚠️ EVERY STOP IS A `partial`, NEVER A SILENT TRUNCATION. Four ways to stop
 * early, each with its reason: the DAS page budget or the Helius credit meter
 * (`helius-budget`), the Rarible page budget (`rarible-budget`), the 20 s wall
 * clock (`timeout`), the 2,000-holding cap (`cap`); plus a venue's read failing
 * outright (`helius-error`, `rarible-error`, `rarible-rate-limited`,
 * `blockscout-error`, `blockscout-rate-limited`, and the Blockscout page
 * budget `blockscout-budget`) and candidates no RPC could confirm
 * (`owner-unverified`). A partial
 * result is returned and priced; the reader is told what is missing. `after` is
 * how many holdings had been read when the enumeration stopped.
 *
 * ⚠️ PRIVACY. Nothing here logs or stores the address. Errors are reported by
 * leg and reason; the upstream error text is dropped, because a Rarible 4xx
 * body can echo the request.
 */
import { dasCall, heliusCreditsUsed, type DasAsset, type DasGroupResponse } from "@/lib/helius/client";
import { rariblePost, RaribleError } from "@/lib/rarible/client";
import { PLATFORM_SOURCES } from "@/lib/data/sources";
import { dasAssetToTokenMetadata } from "@/lib/data/ccTraits";
import { ownersOf, type OwnerMap } from "@/lib/onchain/ownerOf";
import type { TokenMetadata } from "@/lib/onchain/tokenUri";
import type { CardPlatform } from "@/lib/card/ids";
import type { WalletAddress } from "./address";

export type RawHolding = {
  platform: CardPlatform;
  tokenId: string;
  /** Metadata that rode along with the read — DAS inline on Solana,
   *  Blockscout's on Beezie; null on Courtyard (Rarible's item has no name). */
  meta: TokenMetadata | null;
  /** True when the chain itself confirmed the owner: DAS (the chain's own
   *  asset index) on Solana, `ownerOf` on EVM. False only when every RPC
   *  failed to answer — the token is listed, and the result is `partial`. */
  ownerVerified: boolean;
};

export type HoldingsPartial = { reason: string; after: number };

export type HoldingsLeg = {
  /** "collector-crypt:CCrypt…" · "courtyard:POLYGON" */
  leg: string;
  platform: CardPlatform;
  pages: number;
  holdings: number;
  complete: boolean;
  stop?: string;
  /** EVM: index candidates the chain rejected — burned, or owned elsewhere. */
  dropped?: { burned: number; moved: number };
  /** EVM: candidates no RPC could confirm (kept, flagged). */
  unverified?: number;
};

export type HoldingsResult = {
  holdings: RawHolding[];
  partial: HoldingsPartial | null;
  /** What the enumeration spent — for the report and the route's log line. */
  reads: { dasPages: number; heliusCredits: number; rariblePages: number; blockscoutPages: number; ms: number; legs: HoldingsLeg[] };
};

export const VAULT_LIMITS = {
  /** DAS pages per request, across every Solana collection. */
  dasPages: 12,
  /** Rarible pages per request, PER CHAIN. */
  rariblePagesPerChain: 12,
  /** Blockscout pages per request (50 NFTs a page, every collection the
   *  address holds): 40 pages = 2,000 NFTs. Keyless, 150 requests a minute. */
  blockscoutPages: 40,
  /** The whole enumeration's wall clock. */
  wallMs: 20_000,
  /** Holdings per valuation — keeps the cached payload far under 2 MB. */
  maxHoldings: 2_000,
  pageSize: 1_000,
};

type RaribleItem = {
  id: string;
  collection?: string;
  tokenId: string;
  deleted?: boolean;
  supply?: string;
  ownerIfSingle?: string;
};
type RaribleSearchPage = { continuation?: string | null; items?: RaribleItem[] };
type BlockscoutItem = { id: string; token?: { address_hash?: string }; metadata?: { name?: string; image?: string; attributes?: TokenMetadata["attributes"] } | null; image_url?: string | null };
export type BlockscoutPage = { items?: BlockscoutItem[]; next_page_params?: Record<string, string | number> | null };

export type HoldingsDeps = {
  das: (params: Record<string, unknown>) => Promise<DasGroupResponse>;
  raribleSearch: (body: Record<string, unknown>, timeoutMs: number) => Promise<RaribleSearchPage>;
  blockscout: (host: string, address: string, next: Record<string, string | number> | null, timeoutMs: number) => Promise<BlockscoutPage>;
  owners: (chain: "polygon" | "base", contract: string, tokenIds: string[], deadline: number) => Promise<OwnerMap>;
  credits: () => number;
  now: () => number;
};

const defaultDeps: HoldingsDeps = {
  das: (params) => dasCall<DasGroupResponse>("searchAssets", params),
  // Two attempts, bounded by what is left of the wall clock: a request path
  // cannot sit through the warmer-grade 5 × 30 s retry ladder.
  raribleSearch: (body, timeoutMs) => rariblePost<RaribleSearchPage>("/items/search", body, { maxAttempts: 2, timeoutMs }),
  blockscout: fetchBlockscoutPage,
  owners: (chain, contract, ids, deadline) => ownersOf(chain, contract, ids, { deadline }).then((r) => r.owners),
  credits: heliusCreditsUsed,
  now: Date.now,
};

class BlockscoutError extends Error {
  constructor(public status: number) {
    super(`Blockscout ${status}`);
  }
}

/** One page of an address's ERC-721s from a Blockscout instance. */
async function fetchBlockscoutPage(host: string, address: string, next: Record<string, string | number> | null, timeoutMs: number): Promise<BlockscoutPage> {
  const url = new URL(`https://${host}/api/v2/addresses/${address}/nft`);
  url.searchParams.set("type", "ERC-721");
  for (const [k, v] of Object.entries(next ?? {})) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new BlockscoutError(res.status);
  return (await res.json()) as BlockscoutPage;
}

/** Which index finds a venue's EVM candidates — measured, see the header. */
const EVM_INDEX: Partial<Record<CardPlatform, "rarible" | "blockscout">> = { courtyard: "rarible", beezie: "blockscout" };
const BLOCKSCOUT_HOST: Record<string, string> = { BASE: "base.blockscout.com", POLYGON: "polygon.blockscout.com" };

type EvmLeg = { kind: "rarible" | "blockscout"; platform: CardPlatform; collection: string; blockchain: string };
type Leg = { kind: "das"; platform: CardPlatform; collection: string } | EvmLeg;

/** The legs an address is read on, from the registry. */
export function legsFor(chain: WalletAddress["chain"]): Leg[] {
  const legs: Leg[] = [];
  for (const s of PLATFORM_SOURCES) {
    if (s.key === "dyli") continue; // Abstract, ERC-1155, custodial: no per-wallet read in this bet
    const platform = s.key as CardPlatform;
    if (chain === "solana" && s.kind === "helius") {
      for (const c of [s.collectionAddress, ...(s.extraCollections ?? [])].filter(Boolean)) legs.push({ kind: "das", platform, collection: c });
    }
    if (chain === "evm" && s.kind === "rarible") {
      legs.push({ kind: EVM_INDEX[platform] ?? "rarible", platform, collection: s.collectionId, blockchain: s.collectionId.split(":")[0] });
    }
  }
  return legs;
}

/** Wall-clock time held back for the on-chain owner check (measured 0.1–2.4 s). */
const OWNER_CHECK_MS = 3_000;

const TIMEOUT = Symbol("timeout");
function beforeDeadline<T>(p: Promise<T>, msLeft: number): Promise<T | typeof TIMEOUT> {
  if (msLeft <= 0) {
    p.catch(() => {}); // abandoned: never an unhandled rejection
    return Promise.resolve(TIMEOUT);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<typeof TIMEOUT>((r) => (timer = setTimeout(() => r(TIMEOUT), msLeft)));
  return Promise.race([p, t]).finally(() => clearTimeout(timer)) as Promise<T | typeof TIMEOUT>;
}

export async function enumerateHoldings(
  parsed: WalletAddress,
  opts: Partial<typeof VAULT_LIMITS> & { deps?: Partial<HoldingsDeps> } = {},
): Promise<HoldingsResult> {
  const lim = { ...VAULT_LIMITS, ...opts };
  const deps = { ...defaultDeps, ...opts.deps };
  const t0 = deps.now();
  const deadline = t0 + lim.wallMs;
  const credits0 = deps.credits();

  const holdings: RawHolding[] = [];
  let firstStop: string | null = null;
  let halted = false; // a stop that ends EVERY leg (timeout, cap, the DAS budget)
  const stop = (reason: string, all: boolean) => {
    firstStop ??= reason;
    if (all) halted = true;
  };
  let dasPages = 0;
  let blockscoutPages = 0;
  const rariblePagesByChain = new Map<string, number>();
  const seen = new Set<string>();
  const add = (h: RawHolding): boolean => {
    const k = `${h.platform}:${h.tokenId}`;
    if (seen.has(k)) return true;
    if (holdings.length >= lim.maxHoldings) {
      stop("cap", true);
      return false;
    }
    seen.add(k);
    holdings.push(h);
    return true;
  };

  async function readDas(leg: Extract<Leg, { kind: "das" }>, out: HoldingsLeg): Promise<void> {
    for (let page = 1; ; page++) {
      if (halted) return;
      if (dasPages >= lim.dasPages) return void stop("helius-budget", true);
      dasPages++;
      out.pages++;
      let r: DasGroupResponse | typeof TIMEOUT;
      try {
        r = await beforeDeadline(
          deps.das({ ownerAddress: parsed.address, grouping: ["collection", leg.collection], page, limit: lim.pageSize, burnt: false }),
          deadline - deps.now(),
        );
      } catch (e) {
        // The shared meter throws when this process has spent its Helius budget.
        const budget = /credit budget exceeded/i.test((e as Error).message ?? "");
        out.stop = budget ? "helius-budget" : "helius-error";
        return void stop(out.stop, budget);
      }
      if (r === TIMEOUT) {
        out.stop = "timeout";
        return void stop("timeout", true);
      }
      const items: DasAsset[] = r.items ?? [];
      for (const a of items) {
        // The index answered for this owner; a row it attributes elsewhere is
        // not this wallet's, whatever the filter meant to return.
        if (a.ownership?.owner && a.ownership.owner !== parsed.address) continue;
        if (!add({ platform: leg.platform, tokenId: a.id, meta: dasAssetToTokenMetadata(a), ownerVerified: true })) return;
        out.holdings++;
      }
      if (items.length < lim.pageSize) {
        out.complete = true;
        return;
      }
    }
  }

  type Candidate = { tokenId: string; meta: TokenMetadata | null };

  async function readRarible(leg: EvmLeg, out: HoldingsLeg): Promise<Candidate[]> {
    const owner = `ETHEREUM:${parsed.address}`; // Rarible's union address: one EVM space
    const candidates: Candidate[] = [];
    let continuation: string | undefined;
    // 1. The index: candidates, page by page, within the page budget.
    for (;;) {
      if (halted) break;
      const used = rariblePagesByChain.get(leg.blockchain) ?? 0;
      if (used >= lim.rariblePagesPerChain) {
        out.stop = "rarible-budget";
        stop("rarible-budget", false);
        break;
      }
      // The chain check needs its own few seconds inside the same wall clock,
      // so the index stops paging with OWNER_CHECK_MS still on it.
      const left = deadline - OWNER_CHECK_MS - deps.now();
      if (left <= 0) {
        out.stop = "timeout";
        stop("timeout", true);
        break;
      }
      rariblePagesByChain.set(leg.blockchain, used + 1);
      out.pages++;
      let r: RaribleSearchPage | typeof TIMEOUT;
      try {
        r = await beforeDeadline(
          deps.raribleSearch(
            { size: lim.pageSize, ...(continuation ? { continuation } : {}), filter: { blockchains: [leg.blockchain], owners: [owner], collections: [leg.collection] } },
            Math.max(1, Math.min(left, 10_000)),
          ),
          left,
        );
      } catch (e) {
        const status = e instanceof RaribleError ? e.status : 0;
        out.stop = status === 429 ? "rarible-rate-limited" : status === 408 ? "timeout" : "rarible-error";
        stop(out.stop, out.stop === "timeout");
        break;
      }
      if (r === TIMEOUT) {
        out.stop = "timeout";
        stop("timeout", true);
        break;
      }
      const items = r.items ?? [];
      for (const it of items) {
        // Cheap pre-filters on what the index itself admits: a `deleted` item
        // with supply 0 is a burn it DID see, and a single owner that is
        // someone else is a transfer it did see.
        if (it.deleted || it.supply === "0") continue;
        if (it.collection && it.collection.toLowerCase() !== leg.collection.toLowerCase()) continue;
        if (it.ownerIfSingle && it.ownerIfSingle.toLowerCase() !== owner.toLowerCase()) continue;
        candidates.push({ tokenId: it.tokenId, meta: null });
      }
      continuation = r.continuation ?? undefined;
      if (!continuation || items.length < lim.pageSize) {
        out.complete = true;
        break;
      }
    }
    return candidates;
  }

  async function readBlockscout(leg: EvmLeg, out: HoldingsLeg): Promise<Candidate[]> {
    const host = BLOCKSCOUT_HOST[leg.blockchain];
    const contract = leg.collection.split(":")[1].toLowerCase();
    const candidates: Candidate[] = [];
    let next: Record<string, string | number> | null = null;
    for (;;) {
      if (halted) break;
      if (out.pages >= lim.blockscoutPages) {
        out.stop = "blockscout-budget";
        stop("blockscout-budget", false);
        break;
      }
      const left = deadline - OWNER_CHECK_MS - deps.now();
      if (left <= 0) {
        out.stop = "timeout";
        stop("timeout", true);
        break;
      }
      out.pages++;
      blockscoutPages++;
      let r: BlockscoutPage | typeof TIMEOUT;
      try {
        r = await beforeDeadline(deps.blockscout(host, parsed.address, next, Math.max(1, Math.min(left, 10_000))), left);
      } catch (e) {
        const status = e instanceof BlockscoutError ? e.status : 0;
        out.stop = status === 429 ? "blockscout-rate-limited" : (e as Error).name === "TimeoutError" ? "timeout" : "blockscout-error";
        stop(out.stop, out.stop === "timeout");
        break;
      }
      if (r === TIMEOUT) {
        out.stop = "timeout";
        stop("timeout", true);
        break;
      }
      for (const it of r.items ?? []) {
        if (it.token?.address_hash?.toLowerCase() !== contract) continue; // the page spans every collection held
        const m = it.metadata;
        candidates.push({
          tokenId: it.id,
          meta: m?.name ? { name: m.name, attributes: m.attributes, image: m.image ?? it.image_url ?? undefined } : null,
        });
      }
      next = r.next_page_params ?? null;
      if (!next) {
        out.complete = true;
        break;
      }
    }
    return candidates;
  }

  /** The chain: what the address owns NOW. Whatever pages were read are
   *  verified even after a stop — a partial list is still a true one. */
  async function verifyAndAdd(leg: EvmLeg, out: HoldingsLeg, candidates: Candidate[]): Promise<void> {
    if (!candidates.length) return;
    const chain = leg.blockchain === "BASE" ? "base" : "polygon";
    const contract = leg.collection.split(":")[1];
    const owners = await deps.owners(chain, contract, [...new Set(candidates.map((c) => c.tokenId))], deadline).catch(() => new Map<string, string>());
    const me = parsed.address.toLowerCase();
    let burned = 0;
    let moved = 0;
    let unverified = 0;
    for (const c of candidates) {
      const o = owners.get(c.tokenId);
      if (o === "none") burned++;
      else if (o && o !== me) moved++;
      else {
        if (!o) unverified++;
        if (!add({ platform: leg.platform, tokenId: c.tokenId, meta: c.meta, ownerVerified: !!o })) break;
        out.holdings++;
      }
    }
    out.dropped = { burned, moved };
    if (unverified) {
      out.unverified = unverified;
      stop("owner-unverified", false);
    }
  }

  const legs = legsFor(parsed.chain);
  const outs: HoldingsLeg[] = legs.map((l) => ({
    leg: l.kind === "das" ? `${l.platform}:${l.collection}` : `${l.platform}:${l.blockchain}`,
    platform: l.platform,
    pages: 0,
    holdings: 0,
    complete: false,
  }));
  await Promise.all(
    legs.map(async (l, i) => {
      if (l.kind === "das") return readDas(l, outs[i]);
      const candidates = l.kind === "blockscout" ? await readBlockscout(l, outs[i]) : await readRarible(l, outs[i]);
      return verifyAndAdd(l, outs[i], candidates);
    }),
  );

  // A leg that never ran (the budget or the clock went first) is incomplete by
  // the shared reason, so the report says why every leg stopped.
  for (const o of outs) if (!o.complete && !o.stop && firstStop) o.stop = firstStop;
  const incomplete = outs.some((o) => !o.complete);
  return {
    holdings,
    partial: incomplete || firstStop ? { reason: firstStop ?? "incomplete", after: holdings.length } : null,
    reads: {
      dasPages,
      heliusCredits: deps.credits() - credits0,
      rariblePages: [...rariblePagesByChain.values()].reduce((a, b) => a + b, 0),
      blockscoutPages,
      ms: deps.now() - t0,
      legs: outs,
    },
  };
}
