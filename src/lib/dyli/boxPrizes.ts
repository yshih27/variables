/**
 * DYLI box prizes — what each box advertises it holds (`chase_cards` on
 * GET /boxes/{boxId}, the top remaining hits with name, art, FMV and quantity
 * left) and what it paid out recently, named (`title` on /boxes/{id}/history,
 * which `gacha_pulls` has no column for). Kept in the `dyli:box-prizes`
 * snapshot by warm-dyli-boxes and read by the gacha pack warmer.
 *
 * Probed Oct 7 2026 against the v1.1 route list: `/boxes/{boxId}` carries
 * `chase_cards` and `top_chase_cards` (6 each); `/boxes/{boxId}/ranges` carries
 * counts and inventory value per odds range, not the items. So a box's pool on
 * the comparison is its advertised chase list, stated basis.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";

export const DYLI_BOX_PRIZES_KEY = "dyli:box-prizes";
/** Named recent pulls kept per box. */
export const RECENT_PER_BOX = 40;

export type DyliChaseCard = { productId: number | null; name: string; image: string | null; fmvUsd: number; live: boolean; qtyRemaining: number | null };
export type DyliRecentPull = { pullId: number; collectibleId: number | null; title: string; image: string | null; fmvUsd: number | null; tier: string | null; pulledAt: string };
export type DyliBoxPrizes = { name: string | null; image: string | null; brand: string | null; type: string | null; chase: DyliChaseCard[]; recent: DyliRecentPull[] };
export type DyliBoxPrizesSnapshot = { generatedAt: string; boxes: Record<string, DyliBoxPrizes> };

/** Raw `chase_cards` rows → chase cards, value-desc, deduped by product. Pure. */
export function chaseOf(raw: unknown): DyliChaseCard[] {
  const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const seen = new Set<string>();
  const out: DyliChaseCard[] = [];
  for (const r of rows) {
    const name = typeof r.name === "string" ? r.name : null;
    const fmv = Number(r.fmv_usd ?? r.price);
    if (!name || !(fmv > 0)) continue;
    const key = String(r.product_id ?? name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      productId: r.product_id != null ? Number(r.product_id) : null,
      name,
      image: (r.image_url as string) ?? (r.image as string) ?? null,
      fmvUsd: fmv,
      live: r.live !== false,
      qtyRemaining: r.qty_remaining != null && Number.isFinite(Number(r.qty_remaining)) ? Number(r.qty_remaining) : null,
    });
  }
  return out.sort((a, b) => b.fmvUsd - a.fmvUsd);
}

/** Merge newly fetched named pulls into a box's recent list: newest first, one per pull id, capped. Pure. */
export function mergeRecent(prev: DyliRecentPull[], fresh: DyliRecentPull[], cap = RECENT_PER_BOX): DyliRecentPull[] {
  const byId = new Map<number, DyliRecentPull>();
  for (const p of [...fresh, ...prev]) if (p.title && !byId.has(p.pullId)) byId.set(p.pullId, p);
  return [...byId.values()].sort((a, b) => b.pulledAt.localeCompare(a.pulledAt)).slice(0, cap);
}

export function readDyliBoxPrizes(): Promise<DyliBoxPrizesSnapshot | null> {
  return readSnapshot<DyliBoxPrizesSnapshot>(DYLI_BOX_PRIZES_KEY);
}

export function writeDyliBoxPrizes(s: DyliBoxPrizesSnapshot): Promise<void> {
  return writeSnapshot(DYLI_BOX_PRIZES_KEY, s, s.generatedAt);
}
