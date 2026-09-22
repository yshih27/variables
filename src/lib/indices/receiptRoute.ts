/**
 * THE RECEIPTS URL — `/index/<entity>/<month>`, one derivation.
 *
 * A blob entity id is `market:total`, `ip:pokemon`, `category:tcg`,
 * `grade:psa-10`, `set:pokemon:151`, `premium:psa-10:psa-9` — colons, which a
 * path cannot carry cleanly. This module is the ONE map between the two, both
 * ways, so a `receipts →` link on a chart and the route that answers it cannot
 * drift: every link is `receiptsHref(entityId, ts)` and the page parses with
 * `entityIdFromPath(segments)`.
 *
 *   market:total         → /index/market/2026-08
 *   ip:pokemon           → /index/pokemon/2026-08
 *   category:tcg         → /index/category/tcg/2026-08
 *   grade:psa-10         → /index/grade/psa-10/2026-08
 *   set:pokemon:151      → /index/set/pokemon-151/2026-08
 *   premium:psa-10:psa-9 → /index/premium/psa-10~psa-9/2026-08
 *
 * ⚠️ THE SET AND PREMIUM FORMS ARE LOSSY IN ONE DIRECTION ONLY. `set:<ip>:<key>`
 * becomes `<ip>-<key>` and is split back on the FIRST hyphen, which is right
 * because an ip key never contains one (`pokemon`, `one_piece`) while a set key
 * routinely does (`sv-black-star-promo`). A premium's two grades are joined with
 * `~` for the same reason — both halves carry hyphens. Round-tripped in the
 * route's own check below.
 */

/** "2026-08-31T00:00:00.000Z" | "2026-08-31" | "2026-08" → "2026-08". */
export function receiptMonth(ts: string): string {
  if (/^\d{4}-\d{2}/.test(ts)) return ts.slice(0, 7);
  const t = Date.parse(ts);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 7) : ts;
}

/** The path segments for an entity id, without the `/index` prefix. */
export function entityPath(entityId: string): string[] {
  const i = entityId.indexOf(":");
  const entity = i < 0 ? entityId : entityId.slice(0, i);
  const key = i < 0 ? "" : entityId.slice(i + 1);
  switch (entity) {
    case "market":
      return ["market"];
    // An IP is its own first segment: /index/pokemon/2026-08 reads as the page
    // it explains, and no IP key collides with the entity words below.
    case "ip":
      return [key];
    case "set": {
      const j = key.indexOf(":");
      return ["set", j < 0 ? key : `${key.slice(0, j)}-${key.slice(j + 1)}`];
    }
    case "premium":
      return ["premium", key.replace(":", "~")];
    default:
      return [entity, key].filter(Boolean);
  }
}

/** The receipts page for one entity-month. */
export function receiptsHref(entityId: string, ts: string): string {
  return `/index/${[...entityPath(entityId), receiptMonth(ts)].join("/")}`;
}

/** Entity words that take a key segment after them. */
const KEYED = new Set(["set", "grade", "category", "premium", "ip"]);

/**
 * The entity id behind a `/index/...` path's segments (the month already taken
 * off), or null when the shape is not one this route serves.
 */
export function entityIdFromPath(segs: string[]): string | null {
  if (segs.length === 0 || segs.length > 2) return null;
  if (segs.length === 1) {
    const [only] = segs;
    if (!/^[a-z0-9_-]+$/.test(only)) return null;
    if (only === "market") return "market:total";
    // A bare segment that is not a keyed entity word is an IP key.
    if (KEYED.has(only)) return null;
    return `ip:${only}`;
  }
  const [entity, key] = segs;
  if (!KEYED.has(entity) || !/^[a-z0-9_~-]+$/.test(key)) return null;
  if (entity === "set") {
    const j = key.indexOf("-");
    return j <= 0 ? null : `set:${key.slice(0, j)}:${key.slice(j + 1)}`;
  }
  if (entity === "premium") {
    const j = key.indexOf("~");
    return j <= 0 ? null : `premium:${key.slice(0, j)}:${key.slice(j + 1)}`;
  }
  return `${entity}:${key}`;
}

/** "2026-08" → true. The route's own cheap check before any read. */
export function isReceiptMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}
