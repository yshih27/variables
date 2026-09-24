/**
 * ERC-721 `ownerOf` for many tokens in ONE `eth_call` — Multicall3's
 * `aggregate3` with `allowFailure`, so a burned token reverts on its own line
 * instead of failing the call.
 *
 * ⚠️ WHY THIS EXISTS: AN INDEXER'S OWNERSHIP IS A CLAIM, THE CHAIN IS THE FACT.
 * Measured 2026-09-24 on a recent Beezie buyer: Rarible's `items/search` listed
 * 11 Beezie tokens under the wallet; on-chain (three independent Base RPCs) it
 * held NONE — ten had been burned (redeemed for the physical item; the index
 * never saw the BURN) and one sold on Sep 15 (the index had the SELL activity
 * and still named the seller as owner). Pricing the index's list would value a
 * vault its owner no longer has. So the index finds candidates and this
 * decides.
 *
 * ⚠️ WHY NOT JSON-RPC BATCHING: the public endpoints cap it (measured:
 * mainnet.base.org 10 calls per batch, drpc 3 on the free plan). One multicall
 * is one call, whatever it carries.
 *
 * Multicall3 lives at the same address on Base and Polygon.
 */
import { RPCS } from "./tokenUri";

export const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const SEL_AGGREGATE3 = "82ad56cb";
const SEL_OWNER_OF = "6352211e";

/** Per token: the owner (lower-cased `0x…`), "none" when `ownerOf` reverts
 *  (burned, or never minted), or absent from the map when no RPC answered. */
export type OwnerMap = Map<string, string>;

const word = (hex: string) => hex.padStart(64, "0");
const u256 = (n: number | bigint) => BigInt(n).toString(16).padStart(64, "0");

/** ABI-encode `aggregate3((address,bool,bytes)[])` of `ownerOf(id)` calls. */
export function encodeOwnerOfMulticall(contract: string, tokenIds: string[]): string {
  const target = word(contract.toLowerCase().replace(/^0x/, ""));
  const n = tokenIds.length;
  // Each tuple: target, allowFailure, offset-to-bytes (0x60), bytes length (36),
  // 36 bytes of call data padded to 64 → 6 words.
  const TUPLE_WORDS = 6;
  let out = SEL_AGGREGATE3 + u256(0x20) + u256(n);
  for (let i = 0; i < n; i++) out += u256(n * 32 + i * TUPLE_WORDS * 32);
  for (const id of tokenIds) {
    const data = SEL_OWNER_OF + u256(BigInt(id));
    out += target + u256(1) + u256(0x60) + u256(36) + data.padEnd(128, "0");
  }
  return `0x${out}`;
}

/** Decode `(bool success, bytes returnData)[]` into owners / "none". */
export function decodeOwnerOfMulticall(result: string, tokenIds: string[]): OwnerMap {
  const hex = result.replace(/^0x/, "");
  const at = (byteOff: number) => BigInt(`0x${hex.slice(byteOff * 2, byteOff * 2 + 64) || "0"}`);
  const out: OwnerMap = new Map();
  const arr = Number(at(0));
  const n = Number(at(arr));
  if (n !== tokenIds.length) throw new Error(`multicall returned ${n} results for ${tokenIds.length} calls`);
  const base = arr + 32;
  for (let i = 0; i < n; i++) {
    const t = base + Number(at(base + i * 32));
    const success = at(t) === BigInt(1);
    const b = t + Number(at(t + 32));
    const len = Number(at(b));
    const data = hex.slice((b + 32) * 2, (b + 32 + len) * 2);
    out.set(tokenIds[i], success && len >= 32 ? `0x${data.slice(24, 64)}` : "none");
  }
  return out;
}

async function ethCall(rpc: string, to: string, data: string, timeoutMs: number): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: string };
    return typeof body.result === "string" && body.result.length > 2 ? body.result : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Owners for many tokens of one ERC-721, chunked at 300 per call. Each chunk
 * is sent to EVERY RPC for the chain at once and the first valid answer wins.
 *
 * ⚠️ RACED, NOT TRIED IN TURN. Measured 2026-09-24 from one host within the
 * same minute: base-rpc.publicnode answered in 2.4 s while mainnet.base.org,
 * llamarpc and drpc all hung past 8 s — and a minute earlier it was the other
 * way round. In turn, a chunk could spend 24 s before an answer; raced, it
 * costs the fastest endpoint's time. A chunk no RPC answers before the
 * deadline is left out of the map — the caller decides what unknown means.
 */
export async function ownersOf(
  chain: "polygon" | "base",
  contract: string,
  tokenIds: string[],
  opts: { deadline?: number; chunk?: number } = {},
): Promise<{ owners: OwnerMap; calls: number }> {
  const owners: OwnerMap = new Map();
  const ids = [...new Set(tokenIds)];
  const chunk = opts.chunk ?? 300;
  const deadline = opts.deadline ?? Date.now() + 10_000;
  let calls = 0;
  const slices = Array.from({ length: Math.ceil(ids.length / chunk) }, (_, i) => ids.slice(i * chunk, (i + 1) * chunk));
  await Promise.all(
    slices.map(async (slice) => {
      const data = encodeOwnerOfMulticall(contract, slice);
      const left = deadline - Date.now();
      if (left <= 0) return;
      const attempts = RPCS[chain].map(async (rpc) => {
        calls++;
        const r = await ethCall(rpc, MULTICALL3, data, Math.min(left, 8_000));
        if (!r) throw new Error("no answer");
        return decodeOwnerOfMulticall(r, slice); // a malformed answer throws: the next endpoint may still win
      });
      const first = await Promise.any(attempts).catch(() => null);
      if (first) for (const [k, v] of first) owners.set(k, v);
    }),
  );
  return { owners, calls };
}
