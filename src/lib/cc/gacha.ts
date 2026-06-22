/**
 * Collector Crypt GACHA app API client — gacha.collectorcrypt.com/api.
 *
 * CC's gacha is a separate Next.js app from the main marketplace (whose NestJS
 * api.collectorcrypt.com has no gacha routes). The gacha app exposes its data
 * through unauthenticated same-origin /api routes (discovered 2026-06-10 via
 * live capture — the host is injected at runtime, invisible to bundle greps):
 *
 *   • GET /api/gachas/all — the machine catalog (33 machines, ~14 public):
 *     price, STATED tier probabilities (weightMultipliers, sum=1), per-tier $
 *     ranges, vendor EV (targetEV ≈ 1.05–1.10× price, plus maxEV), instant
 *     buyback %, bigWinChance (= the non-common share, i.e. stated hit odds).
 *   • GET /api/getAllWinners — realized pulls (the pull→prize link Dune can't
 *     give us per-pack). `?count=N` = N most recent overall (cap 200);
 *     `?perTier=N` = N most recent per (machine × tier) — reaches thousands of
 *     pulls in one call. Each row: winner wallet, prize NFT (name + art),
 *     insuredValue (the FMV basis CC itself uses), pack_type (= machine code),
 *     prize_tier, created_at.
 *
 * ⚠️ The perTier sample is STRATIFIED (most-recent-N per tier), so it is NOT a
 * proportional sample of pulls — naive EV/odds over it would overweight rare
 * tiers. The warmer handles that (complete-coverage window); this client only
 * fetches and types.
 *
 * Live per-pull updates additionally stream over Ably websockets (channels
 * `recent-winners-{code}`, event `new-winner`) — not needed for cron polling.
 */

const BASE = "https://gacha.collectorcrypt.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, Accept: "application/json" };

export type CCTierKey = "common" | "uncommon" | "rare" | "epic";

/** prize_tier in the winners feed → tier name. 1 is the RAREST (verified against
 *  tierRanges: pokemon_50 tier-1 values 250–2400 ⊂ epic 250–5001, tier-4 30–58 ⊂
 *  common 30–60). */
export const CC_PRIZE_TIER: Record<number, CCTierKey> = {
  1: "epic",
  2: "rare",
  3: "uncommon",
  4: "common",
};

/** Rarest → commonest, the order the stated odds bands should render in. */
export const CC_TIER_ORDER: CCTierKey[] = ["epic", "rare", "uncommon", "common"];

export type CCGachaMachine = {
  code: string; // durable id, e.g. "pokemon_250" — also the winners' pack_type
  name: string; // "Elite Pokémon Gacha Pack"
  shortName: string; // "PKMN 250"
  image: string; // empty in practice — use ccGachaPackImage(code)
  public: boolean; // private machines aren't purchasable from the menu
  price: { amount: number };
  contains: number; // cards per pull
  instantBuyback?: { percentageOfValue: number }; // e.g. 90 → 0.90 buyback
  /** Stated share of pulls landing above common (= uncommon+rare+epic), in %. */
  bigWinChance: number;
  maxEV: number; // vendor ceiling EV in $ per pull
  targetEV: number; // vendor target EV in $ per pull (the stated EV)
  targetEvMin: number;
  targetEvMax: number;
  /** Per-tier prize-value $ bands. */
  tierRanges?: Partial<Record<CCTierKey, { start: number; end: number }>>;
  /** STATED tier probabilities (0–1, sum ≈ 1) — the advertised odds. */
  weightMultipliers?: Partial<Record<CCTierKey, number>>;
  turboMode?: boolean;
  menuCategory?: string | null; // "Pokemon" | "One Piece" | "Sports" | "Pop" | ""
  menuOrder?: number;
};

/** One realized pull, reduced from the winners feed's full DAS NFT blob. */
export type CCWinner = {
  wallet: string;
  mint: string; // prize NFT address — links to collectorcrypt.com/assets/solana/{mint}
  name: string | null; // card name, e.g. "2025 #161 Articuno PSA 9 Jtg EN-"
  image: string | null; // cc CDN art where present, else arweave
  valueUsd: number; // insuredValue — CC's own FMV basis
  at: string; // created_at ISO
  packCode: string; // pack_type = machine code
  tier: CCTierKey | null;
};

type RawWinner = {
  winner?: string;
  nft_address?: string;
  insuredValue?: number;
  created_at?: string;
  pack_type?: string;
  prize_tier?: number;
  nft?: {
    content?: {
      metadata?: { name?: string };
      links?: { image?: string };
      files?: { uri?: string; cc_cdn?: string }[];
    };
  };
};

/** Machine/pack art (the catalog's own `image` field is empty in practice). */
export function ccGachaPackImage(code: string): string {
  return `${BASE}/${code}.png`;
}

/** Fetch the machine catalog. Throws on non-200. */
export async function fetchCCGachaCatalog(): Promise<CCGachaMachine[]> {
  const res = await fetch(`${BASE}/api/gachas/all`, { headers: HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`CC /api/gachas/all ${res.status}`);
  const d = (await res.json()) as CCGachaMachine[];
  return Array.isArray(d) ? d : [];
}

function mapWinners(rows: RawWinner[]): CCWinner[] {
  const out: CCWinner[] = [];
  for (const r of rows) {
    if (!r.nft_address || !r.pack_type || !r.created_at) continue;
    const content = r.nft?.content;
    const file = content?.files?.[0];
    out.push({
      wallet: r.winner ?? "",
      mint: r.nft_address,
      name: content?.metadata?.name ?? null,
      image: file?.cc_cdn ?? content?.links?.image ?? file?.uri ?? null,
      valueUsd: Number(r.insuredValue) || 0,
      at: r.created_at,
      packCode: r.pack_type,
      tier: CC_PRIZE_TIER[r.prize_tier ?? -1] ?? null,
    });
  }
  return out;
}

/**
 * Fetch realized pulls, `perTier` most recent per (machine × tier). 100 per tier
 * reaches ~7–8K pulls (~22MB — trimmed to CCWinner immediately). Throws on non-200.
 */
export async function fetchCCWinners(perTier = 100): Promise<CCWinner[]> {
  const res = await fetch(`${BASE}/api/getAllWinners?perTier=${perTier}`, {
    headers: HEADERS,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`CC /api/getAllWinners ${res.status}`);
  const d = (await res.json()) as { success?: boolean; data?: RawWinner[] };
  return mapWinners(d.data ?? []);
}

/**
 * The `count` most recent pulls overall (API caps at 200). At CC's observed
 * ~24 pulls/min that's an ~8-minute buffer — polled every 1–2 minutes it
 * captures the COMPLETE pull stream over plain HTTP (no websocket needed).
 */
export async function fetchCCRecentWinners(count = 200): Promise<CCWinner[]> {
  const res = await fetch(`${BASE}/api/getAllWinners?count=${count}`, {
    headers: HEADERS,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`CC /api/getAllWinners ${res.status}`);
  const d = (await res.json()) as { success?: boolean; data?: RawWinner[] };
  return mapWinners(d.data ?? []);
}
