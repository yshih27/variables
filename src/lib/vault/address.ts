/**
 * THE ADDRESS — one input, the chain detected, never asked.
 *
 * A vault lookup takes whatever the reader pastes and decides which chain it
 * names from its shape alone:
 *
 *   • Solana — base58 that decodes to exactly 32 bytes (an ed25519 public key).
 *     Read on Collector Crypt and Phygitals, both.
 *   • EVM    — `0x` + 40 hex. One address space, so it is read on Polygon
 *     (Courtyard) and Base (Beezie), both. Returned lower-cased.
 *
 * ⚠️ A MIXED-CASE EVM ADDRESS IS A CHECKSUM CLAIM. EIP-55 encodes a checksum in
 * the letter case; an address typed or pasted with one character wrong still
 * looks like an address, and reading the wrong wallet would price a stranger's
 * vault as the reader's. So a mixed-case input must pass EIP-55 or it is
 * rejected as a typo. All-lower and all-upper carry no checksum and are
 * accepted as written.
 *
 * No name resolution (ENS / SNS): `vitalik.eth` is not an address and parses
 * to null.
 *
 * Pure, dependency-free (keccak-256 is inlined below: Node's `sha3-256` is the
 * FIPS padding, not Ethereum's keccak, and they differ on every input).
 */

export type WalletAddress = { chain: "solana"; address: string } | { chain: "evm"; address: string };

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map([...BASE58].map((c, i) => [c, i]));

/** Base58 → bytes, or null on a character outside the alphabet. */
export function base58Decode(s: string): Uint8Array | null {
  if (!s) return null;
  const bytes: number[] = [0];
  for (const ch of s) {
    const v = BASE58_INDEX.get(ch);
    if (v === undefined) return null;
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Each leading "1" is a leading zero byte.
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  const body = bytes.reverse();
  // A value of zero decodes to [0]; drop that placeholder before re-padding.
  const trimmed = body.length === 1 && body[0] === 0 ? [] : body;
  return Uint8Array.from([...new Array(zeros).fill(0), ...trimmed]);
}

// ── keccak-256 (Ethereum's, pre-FIPS padding) ────────────────────────────────
// BigInt() calls, not literals: the tsconfig target predates ES2020.
const N0 = BigInt(0);
const N8 = BigInt(8);
const NFF = BigInt(0xff);

const RC: bigint[] = [
  "0x0000000000000001", "0x0000000000008082", "0x800000000000808a", "0x8000000080008000",
  "0x000000000000808b", "0x0000000080000001", "0x8000000080008081", "0x8000000000008009",
  "0x000000000000008a", "0x0000000000000088", "0x0000000080008009", "0x000000008000000a",
  "0x000000008000808b", "0x800000000000008b", "0x8000000000008089", "0x8000000000008003",
  "0x8000000000008002", "0x8000000000000080", "0x000000000000800a", "0x800000008000000a",
  "0x8000000080008081", "0x8000000000008080", "0x0000000080000001", "0x8000000080008008",
].map((h) => BigInt(h));
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const M64 = (BigInt(1) << BigInt(64)) - BigInt(1);
const rotl = (x: bigint, n: number) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64);

function keccakF(s: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    const c = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) s[x + y] ^= d;
    }
    const b = new Array<bigint>(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = b[x + 5 * y] ^ (~b[((x + 1) % 5) + 5 * y] & M64 & b[((x + 2) % 5) + 5 * y]);
    s[0] ^= RC[round];
  }
}

/** keccak-256 of a byte string, as lower-case hex. */
export function keccak256Hex(input: Uint8Array): string {
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((input.length + 1) / rate) * rate);
  padded.set(input);
  padded[input.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const s = new Array<bigint>(25).fill(N0);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = N0;
      for (let j = 7; j >= 0; j--) lane = (lane << N8) | BigInt(padded[off + i * 8 + j]);
      s[i] ^= lane;
    }
    keccakF(s);
  }
  let out = "";
  for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) out += Number((s[i] >> BigInt(8 * j)) & NFF).toString(16).padStart(2, "0");
  return out;
}

/** The EIP-55 checksummed form of a 40-hex address (without `0x`, any case). */
export function toChecksumAddress(hex40: string): string {
  const lower = hex40.toLowerCase();
  const hash = keccak256Hex(new TextEncoder().encode(lower));
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  return out;
}

/**
 * Parse whatever the reader pasted. Surrounding whitespace is ignored; nothing
 * else is forgiven.
 */
export function parseWalletAddress(input: string | null | undefined): WalletAddress | null {
  const s = (input ?? "").trim();
  if (!s) return null;

  const evm = /^0x([0-9a-fA-F]{40})$/.exec(s);
  if (evm) {
    const hex = evm[1];
    const mixed = hex !== hex.toLowerCase() && hex !== hex.toUpperCase();
    if (mixed && toChecksumAddress(hex) !== `0x${hex}`) return null;
    return { chain: "evm", address: `0x${hex.toLowerCase()}` };
  }

  // A Solana public key is 32 bytes: 32–44 base58 characters.
  if (s.length >= 32 && s.length <= 44) {
    const bytes = base58Decode(s);
    if (bytes && bytes.length === 32) return { chain: "solana", address: s };
  }
  return null;
}
