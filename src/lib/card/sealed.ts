/**
 * Sealed-vs-slab heuristic for CARD ART framing (R6-1), client-usable. Mirrors
 * the backend `classifyKind` in fetchTrending.ts, but the frontend often only has
 * a name (Top Sales / gacha hits / card page carry no `kind` field yet), so this
 * infers from the name (+ grade when available): a graded item is always a slab
 * (a single card); an ungraded item whose name reads like a product is sealed.
 *
 * Sealed boxes are white-bg product shots (often near-square) — knowing an item
 * is sealed lets the art use a squarer frame + object-contain instead of forcing
 * a landscape box into a portrait slab frame.
 */
const SEALED_PREFIX_RE = /^\s*pokemon tcg:/i;
const SEALED_RE =
  /\b(booster|bundle|box|etb|elite trainer|pack|case|lot|tin|blister|collection|upc|ultra premium|premium collection|display|collection box)\b/i;

export function isSealed(name: string | null | undefined, grade?: string | null): boolean {
  if (grade && grade !== "Ungraded") return false;
  const n = name ?? "";
  return SEALED_PREFIX_RE.test(n) || SEALED_RE.test(n);
}
