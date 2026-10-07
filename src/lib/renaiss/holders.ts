/**
 * Renaiss holders, counted ON-CHAIN on BNB Smart Chain, and the market cap its
 * own stated prize values imply. Run by warm-holders (a Renaiss step beside the
 * Beezie, Collector Crypt and Phygitals scans); measured by
 * scripts/renaiss-holders.ts (a dry run with `--limit`).
 *
 * THE TOKENS. The Renaiss collection (RENAISS_COLLECTION) is ERC721Enumerable,
 * so every live token is read off the chain itself: `totalSupply`, then
 * `tokenByIndex(i)` and `ownerOf(id)` through Multicall3, 300 per call, raced
 * across the public RPCs (onchain/ownerOf.ts). A token that was pulled or sold
 * (the universe: every `prize_instance_id` in `renaiss_pulls` ∪ every
 * `token_id` in `renaiss_sales`) and is no longer enumerated has been burned:
 * `ownerOf` reverts for it. The contract's BURNER_ROLE and `burnToken` suggest
 * redemption for the physical card, but nothing on-chain says so, so it is
 * reported as "burned (likely redeemed)", never "redeemed".
 *
 * WHO IS RENAISS. Holders exclude the zero address, the burn address and the
 * wallets Renaiss operates: the ones the contract itself names (`owner()`,
 * `treasury()`, and every member of DEFAULT_ADMIN_ROLE, MINTER_ROLE and
 * BURNER_ROLE through AccessControlEnumerable), plus OPERATED_EXTRA below for
 * any wallet that the top-owners check identifies and the contract does not
 * name. Each excluded wallet and its token count is reported.
 *
 * THE MARKET CAP. Σ, over tokens held outside Renaiss's wallets, of the value
 * Renaiss STATED for the token at its newest pull (`prize_value_usd`). The same
 * class of figure as Collector Crypt's insured value: the venue's own
 * appraisal, not a price. A held token that never came through a pull, or came
 * through one with no stated value, has none: it counts in the coverage gap,
 * never at zero. Published only when coverage (valued ÷ held) ≥ 80%.
 */
import { db } from "../db/client";
import { readSnapshot, writeSnapshot } from "../db/snapshots";
import { ethCallAny, ownersOf, tokensByIndex } from "../onchain/ownerOf";
import { RENAISS_COLLECTION } from "../data/sources";
import { inChunk } from "../data/cards";
import { STATED_MCAP_MIN_COVERAGE } from "./constants";

export const RENAISS_HOLDINGS_SNAPSHOT_KEY = "renaiss-holdings";
export { STATED_MCAP_MIN_COVERAGE };

const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";

/**
 * Wallets Renaiss operates that the contract does not name, each with the
 * evidence that put it here. Measured Oct 7 (scripts/renaiss-holders.ts and
 * on-chain reads over public BSC RPCs):
 *   • the two largest owners hold 4,981 and 1,898 of 11,215 live tokens (61%);
 *   • neither has ever bought a pack (0 rows as buyer in renaiss_pulls) nor
 *     bought or sold on the marketplace (0 rows as buyer or seller in
 *     renaiss_sales), where every other top-ten owner with tokens in the
 *     hundreds has pulls or sales;
 *   • both are EIP-1967 proxies with their own implementations, where every
 *     player wallet read the same day is a Safe proxy (slot 0 = the Safe
 *     singleton 0x41675c09…461a).
 * Read together: the prize inventory packs draw from, not collectors. The
 * contract itself names neither, so this list is a judgment from data: remove
 * an entry if Renaiss says otherwise. Add one only with the evidence beside it.
 */
export const OPERATED_EXTRA: Record<string, string> = {
  "0x14b662fc59f87ec004c2c25e0a2a49c9f858ef8c": "inventory (no pulls, no trades; EIP-1967 proxy)",
  "0xfda4a907d23d9f24271bc47483c5b983831e325e": "inventory (no pulls, no trades; EIP-1967 proxy)",
};

const SEL = {
  owner: "8da5cb5b",
  treasury: "61d027b3",
  totalSupply: "18160ddd",
  minterRole: "d5391393",
  burnerRole: "282c51f3",
  getRoleMemberCount: "ca15c873",
  getRoleMember: "9010d07c",
};
const u256 = (n: number | bigint) => BigInt(n).toString(16).padStart(64, "0");
const addrOf = (hex: string | null) => (hex && hex.length >= 66 ? `0x${hex.slice(-40)}`.toLowerCase() : null);

async function call(data: string): Promise<string | null> {
  return ethCallAny("bnb", RENAISS_COLLECTION, `0x${data}`);
}

/** The wallets the contract itself names, address → the roles it holds. */
export async function readOperatedWallets(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const add = (a: string | null, role: string) => {
    if (!a || a === ZERO) return;
    out.set(a, [...(out.get(a) ?? []), role]);
  };
  add(addrOf(await call(SEL.owner)), "owner");
  add(addrOf(await call(SEL.treasury)), "treasury");
  const roles: [string, string | null][] = [
    ["DEFAULT_ADMIN_ROLE", "0".repeat(64)],
    ["MINTER_ROLE", (await call(SEL.minterRole))?.replace(/^0x/, "") ?? null],
    ["BURNER_ROLE", (await call(SEL.burnerRole))?.replace(/^0x/, "") ?? null],
  ];
  for (const [label, role] of roles) {
    if (!role) continue;
    const n = Number(BigInt((await call(SEL.getRoleMemberCount + role)) ?? "0x0"));
    for (let i = 0; i < n; i++) add(addrOf(await call(SEL.getRoleMember + role + u256(i))), label);
  }
  for (const [a, why] of Object.entries(OPERATED_EXTRA)) add(a.toLowerCase(), why);
  return out;
}

export type LiveTokens = {
  totalSupply: number;
  /** token id (decimal) → owner (lower-cased), or "none" when ownerOf reverted. */
  owners: Map<string, string>;
  /** Indices or tokens no RPC answered before the deadline: unknown, not counted. */
  unanswered: number;
  calls: number;
  multicalls: number;
  ms: number;
};

/**
 * Every live token and its owner. `maxMulticalls` caps the enumeration (a
 * probe reads the first `maxMulticalls × 300` indices and their owners);
 * Infinity reads them all.
 */
export async function readLiveTokens(opts: { maxMulticalls?: number; chunk?: number; deadlineMs?: number } = {}): Promise<LiveTokens> {
  const t0 = Date.now();
  const chunk = opts.chunk ?? 300;
  const supplyHex = await call(SEL.totalSupply);
  const totalSupply = supplyHex ? Number(BigInt(supplyHex)) : 0;
  const cap = Math.min(totalSupply, Number.isFinite(opts.maxMulticalls ?? Infinity) ? (opts.maxMulticalls as number) * chunk : totalSupply);
  const deadline = Date.now() + (opts.deadlineMs ?? 5 * 60_000);
  const indices = Array.from({ length: cap }, (_, i) => i);
  const { tokens, calls: c1 } = await tokensByIndex("bnb", RENAISS_COLLECTION, indices, { chunk, deadline });
  const ids = [...tokens.values()];
  const { owners, calls: c2 } = await ownersOf("bnb", RENAISS_COLLECTION, ids, { chunk, deadline });
  return {
    totalSupply,
    owners,
    unanswered: cap - tokens.size + (ids.length - owners.size),
    calls: c1 + c2,
    multicalls: Math.ceil(cap / chunk) + Math.ceil(ids.length / chunk),
    ms: Date.now() - t0,
  };
}

/** A token as the pulls feed last stated it. */
export type PulledToken = { valueUsd: number | null; ip: string | null };

/**
 * Every token that came through a pull — `rn-<id>` → its newest pull's stated
 * value and IP (the IP is the first segment of the prize's identity key) — by
 * one keyset pass over the named pulls. `maxPages` caps a probe.
 *
 * `by: "token"` (the default) pages on `prize_instance_id` itself, over the
 * partial index migration 20261007000001 adds: about 700 fast pages. `by:
 * "pull"` pages on the primary key and needs no index, but skips the unnamed
 * early pulls page by page (measured Oct 7 before the migration: 1.2 s a
 * page); it is the probe's fallback until the index exists.
 */
export async function readPulledTokens(opts: { maxPages?: number; by?: "token" | "pull" } = {}): Promise<{ tokens: Map<string, PulledToken & { at: string }>; pages: number; ms: number }> {
  const PAGE = 1000;
  const t0 = Date.now();
  const tokens = new Map<string, PulledToken & { at: string }>();
  const byToken = (opts.by ?? "token") === "token";
  const col = byToken ? "prize_instance_id" : "pull_id";
  let cursor = "";
  let pages = 0;
  // By token, the cursor is a token that may have more pulls past the page's
  // end, so the next page starts AT it (gte) and skips the pulls already read.
  let boundary = new Set<string>();
  for (; pages < (opts.maxPages ?? Infinity); ) {
    let q = db()
      .from("renaiss_pulls")
      .select("pull_id, prize_instance_id, prize_value_usd, prize_canonical_id, pulled_at")
      .not("prize_instance_id", "is", null)
      .order(col, { ascending: true });
    q = byToken ? q.gte(col, cursor).order("pull_id", { ascending: true }) : q.gt(col, cursor);
    const { data, error } = await q.limit(PAGE);
    pages++;
    if (error) throw new Error(`[renaiss_pulls] token read failed: ${error.message}`);
    const rows = data ?? [];
    let fresh = 0;
    for (const r of rows) {
      if (byToken && String(r.prize_instance_id) === cursor && boundary.has(String(r.pull_id))) continue;
      fresh++;
      const id = String(r.prize_instance_id).replace(/^rn-/, "");
      const at = String(r.pulled_at);
      const prev = tokens.get(id);
      if (prev && prev.at >= at) continue;
      const v = r.prize_value_usd == null ? null : Number(r.prize_value_usd);
      const key = r.prize_canonical_id ? String(r.prize_canonical_id) : "";
      tokens.set(id, { valueUsd: v != null && Number.isFinite(v) && v > 0 ? v : null, ip: key ? key.split("|")[0] || null : null, at });
    }
    if (rows.length < PAGE || fresh === 0) break;
    const last = rows[rows.length - 1] as Record<string, unknown>;
    const next = String(last[col]);
    if (byToken) {
      boundary = next === cursor ? boundary : new Set();
      for (const r of rows) if (String(r.prize_instance_id) === next) boundary.add(String(r.pull_id));
    }
    cursor = next;
  }
  return { tokens, pages, ms: Date.now() - t0 };
}

/** The `cards` IP of sold tokens, chunked by id length (Renaiss ids run to 78 digits). */
export async function readSoldTokenIps(tokenIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(tokenIds)];
  const CHUNK = inChunk(ids);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db().from("cards").select("token_id, ip_key").eq("platform", "renaiss").in("token_id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`[cards] renaiss ip read failed: ${error.message}`);
    for (const r of data ?? []) out.set(String(r.token_id), String(r.ip_key ?? "other"));
  }
  return out;
}

/** A wallet's activity in the two stores — the evidence the top-owners check prints. Counts only. */
export async function walletActivity(address: string): Promise<{ packPulls: number; marketplaceBuys: number; marketplaceSells: number }> {
  const a = address.toLowerCase();
  const head = (t: string) => db().from(t).select("*", { count: "exact", head: true });
  const [p, b, s] = await Promise.all([head("renaiss_pulls").eq("buyer", a), head("renaiss_sales").eq("buyer", a), head("renaiss_sales").eq("seller", a)]);
  for (const r of [p, b, s]) if (r.error) throw new Error(`wallet activity read failed: ${r.error.message}`);
  return { packPulls: p.count ?? 0, marketplaceBuys: b.count ?? 0, marketplaceSells: s.count ?? 0 };
}

/** Every token id that has sold on the marketplace, with its `cards` IP where one is stored. */
export async function readSoldTokens(): Promise<Set<string>> {
  const PAGE = 1000;
  const out = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db().from("renaiss_sales").select("token_id").order("sale_id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`[renaiss_sales] token read failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) out.add(String(r.token_id));
    if (rows.length < PAGE) break;
  }
  return out;
}

export type HoldingsSummary = {
  generatedAt: string;
  totalSupply: number;
  liveTokens: number;
  unanswered: number;
  /** Distinct owners outside Renaiss's wallets, the zero and the burn address. */
  holders: number;
  /** Live tokens those holders hold. */
  tokensHeld: number;
  /** Each excluded wallet, with the roles the contract gives it and the tokens it holds. */
  excluded: { address: string; roles: string[]; tokens: number }[];
  /** The top owners by token count, flagged — the check behind the exclusions. */
  topOwners: { address: string; tokens: number; operated: boolean; roles: string[] }[];
  /** Tokens that came through a pull or a sale and are no longer live: burned (likely redeemed). */
  burnedLikelyRedeemed: number;
  /** Tokens that came through a pull or a sale. */
  universe: number;
  /** Live tokens no pull or sale names (minted otherwise): no stated value. */
  liveOutsideUniverse: number;
  stated: { mcapUsd: number; valued: number; held: number; coveragePct: number; publishable: boolean };
  byIp: Record<string, { holders: number; tokens: number; mcapUsd: number; valued: number }>;
};

/**
 * Holders, exclusions, burns and the stated market cap — pure, so the test
 * drives every branch. `ownersByIp` (IP → owner set) is returned beside the
 * summary for the caller's cross-venue union and never stored: addresses stay
 * in memory (the privacy rule in playerAnalytics.ts).
 */
export function summarizeHoldings(input: {
  live: Pick<LiveTokens, "totalSupply" | "owners" | "unanswered">;
  /** Every live token was enumerated (not a capped probe): only then is "burned" a count. */
  complete: boolean;
  operated: Map<string, string[]>;
  pulled: Map<string, PulledToken>;
  sold: Set<string>;
  /** IP for a sold token with a `cards` row; a pulled token's IP comes from its pull. */
  ipOfSold?: Map<string, string>;
  topN?: number;
  nowIso?: string;
}): { summary: HoldingsSummary; ownersByIp: Map<string, Set<string>> } {
  const { live, operated, pulled, sold } = input;
  const perOwner = new Map<string, number>();
  for (const owner of live.owners.values()) if (owner !== "none") perOwner.set(owner, (perOwner.get(owner) ?? 0) + 1);
  const isOut = (a: string) => a === ZERO || a === DEAD || operated.has(a);

  const holders = new Set<string>();
  const ownersByIp = new Map<string, Set<string>>();
  const byIp: HoldingsSummary["byIp"] = {};
  let tokensHeld = 0;
  let valued = 0;
  let mcap = 0;
  let liveOutsideUniverse = 0;
  let liveTokens = 0;
  for (const [token, owner] of live.owners) {
    if (owner === "none") continue;
    liveTokens++;
    const p = pulled.get(token);
    if (!p && !sold.has(token)) liveOutsideUniverse++;
    if (isOut(owner)) continue;
    holders.add(owner);
    tokensHeld++;
    const ip = p?.ip ?? input.ipOfSold?.get(token) ?? "other";
    const row = (byIp[ip] ??= { holders: 0, tokens: 0, mcapUsd: 0, valued: 0 });
    row.tokens++;
    let set = ownersByIp.get(ip);
    if (!set) ownersByIp.set(ip, (set = new Set()));
    set.add(owner);
    if (p?.valueUsd != null) {
      valued++;
      mcap += p.valueUsd;
      row.valued++;
      row.mcapUsd += p.valueUsd;
    }
  }
  for (const [ip, set] of ownersByIp) byIp[ip].holders = set.size;

  const universe = new Set<string>([...pulled.keys(), ...sold]);
  let liveInUniverse = 0;
  for (const t of universe) {
    const o = live.owners.get(t);
    if (o && o !== "none") liveInUniverse++;
  }
  const coverage = tokensHeld > 0 ? valued / tokensHeld : 0;
  const top = [...perOwner.entries()].sort((a, b) => b[1] - a[1]).slice(0, input.topN ?? 10);
  return {
    summary: {
      generatedAt: input.nowIso ?? new Date().toISOString(),
      totalSupply: live.totalSupply,
      liveTokens,
      unanswered: live.unanswered,
      holders: holders.size,
      tokensHeld,
      excluded: [...operated.entries()].map(([address, roles]) => ({ address, roles, tokens: perOwner.get(address) ?? 0 })).sort((a, b) => b.tokens - a.tokens),
      topOwners: top.map(([address, tokens]) => ({ address, tokens, operated: isOut(address), roles: operated.get(address) ?? [] })),
      // Only a token whose absence the enumeration proves: one the probe never
      // reached (a capped run) is not counted as burned.
      burnedLikelyRedeemed: input.complete && live.unanswered === 0 ? universe.size - liveInUniverse : NaN,
      universe: universe.size,
      liveOutsideUniverse,
      stated: {
        mcapUsd: mcap,
        valued,
        held: tokensHeld,
        coveragePct: coverage * 100,
        publishable: tokensHeld > 0 && coverage >= STATED_MCAP_MIN_COVERAGE,
      },
      byIp,
    },
    ownersByIp,
  };
}

export function readRenaissHoldings(): Promise<HoldingsSummary | null> {
  return readSnapshot<HoldingsSummary>(RENAISS_HOLDINGS_SNAPSHOT_KEY);
}

export function writeRenaissHoldings(s: HoldingsSummary): Promise<void> {
  return writeSnapshot(RENAISS_HOLDINGS_SNAPSHOT_KEY, s, s.generatedAt);
}
