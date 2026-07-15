/**
 * Index naming — the single source of truth (SSOT) for the Varible Index family.
 *
 * FROZEN CONTRACT: the frontend, the public API (v1), the weekly report, and the OG
 * images all import `tickerOf` / `indexDisplayName` from here. Never hand-maintain a
 * parallel ticker list anywhere else — per-IP codes are DERIVED from the ipCatalog
 * `short` codes, so adding/renaming an IP in the catalog updates every surface at once.
 *
 * Scheme:
 *   family  = "The Varible Index"  (nickname "the V")
 *   ticker  = "V-" + entity short code, uppercased, globally unique (deduped)
 *     • market   → V-MKT
 *     • category → V-TCG (tcg) · V-SPT (sports) · V-OTH (other residual)
 *     • ip       → V-<catalog short>  (V-PKM, V-OP, V-YGO, …)
 *   display = "The Varible <Name> Index"  (e.g. "The Varible Pokémon Index")
 *
 * Both functions are TOTAL — an unknown key degrades to a derived code / title-cased
 * name and never throws (a naming lookup must not be able to break a page or the API).
 */
import { IP_CATALOG, OTHER_IP, type IPCategory } from "../data/ipCatalog";

export type IndexEntity = "market" | "category" | "ip";

export const INDEX_FAMILY = "The Varible Index";
export const INDEX_FAMILY_SHORT = "the V";
export const TICKER_PREFIX = "V-";

// Market + category short codes live HERE — categories carry no `short` in the
// catalog, and "market" is a singleton. `Record<IPCategory, …>` makes adding a
// category to ipCatalog a compile error until its code + name are defined here.
const MARKET_CODE = "MKT";
const MARKET_NAME = "Market";
const CATEGORY_CODE: Record<IPCategory, string> = { tcg: "TCG", sports: "SPT", other: "OTH" };
const CATEGORY_NAME: Record<IPCategory, string> = { tcg: "TCG", sports: "Sports", other: "Other" };

/** Uppercase + strip anything but A-Z0-9 (so "OP" / "F1" survive, punctuation drops). */
function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function titleCase(key: string): string {
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * IP key → unique ticker code, built ONCE from the catalog. Reserves the market +
 * category codes first, then assigns each IP its normalized `short`; a collision
 * (two IPs normalizing to the same code, or an IP colliding with a reserved code)
 * falls back to the normalized key, then a numeric suffix — so tickers stay globally
 * unique even if the catalog grows a duplicate short. Deterministic (catalog is a
 * static const), so a given key always yields the same ticker.
 */
const IP_CODE_BY_KEY: Map<string, string> = (() => {
  const used = new Set<string>([MARKET_CODE, ...Object.values(CATEGORY_CODE)]);
  const map = new Map<string, string>();
  for (const ip of [...IP_CATALOG, OTHER_IP]) {
    let code = normalizeCode(ip.short) || normalizeCode(ip.key);
    if (used.has(code)) {
      const byKey = normalizeCode(ip.key);
      code = !used.has(byKey) && byKey ? byKey : uniqueSuffix(code || "IP", used);
    }
    used.add(code);
    map.set(ip.key, code);
  }
  return map;
})();

function uniqueSuffix(base: string, used: Set<string>): string {
  let i = 2;
  while (used.has(`${base}${i}`)) i += 1;
  return `${base}${i}`;
}

/** Ticker for an index entity, e.g. tickerOf("ip","pokemon") → "V-PKM". */
export function tickerOf(entity: IndexEntity, key: string): string {
  if (entity === "market") return TICKER_PREFIX + MARKET_CODE;
  if (entity === "category") return TICKER_PREFIX + (CATEGORY_CODE[key as IPCategory] ?? (normalizeCode(key) || "OTH"));
  // ip — derived catalog code, or a defensive fallback for an unknown key.
  return TICKER_PREFIX + (IP_CODE_BY_KEY.get(key) ?? (normalizeCode(key) || "UNK"));
}

/** Full display name, e.g. indexDisplayName("ip","pokemon") → "The Varible Pokémon Index". */
export function indexDisplayName(entity: IndexEntity, key: string): string {
  const middle = indexNoun(entity, key);
  return `${INDEX_FAMILY.replace(/ Index$/, "")} ${middle} Index`;
}

/** The `<X>` in "The Varible <X> Index" — Market / TCG / Pokémon / … */
function indexNoun(entity: IndexEntity, key: string): string {
  if (entity === "market") return MARKET_NAME;
  if (entity === "category") return CATEGORY_NAME[key as IPCategory] ?? titleCase(key);
  if (key === OTHER_IP.key) return OTHER_IP.name;
  return IP_CATALOG.find((i) => i.key === key)?.name ?? titleCase(key);
}

export type IndexIdentity = { entity: IndexEntity; key: string; ticker: string; name: string };

function identity(entity: IndexEntity, key: string): IndexIdentity {
  return { entity, key, ticker: tickerOf(entity, key), name: indexDisplayName(entity, key) };
}

/**
 * The curated list of LIVE, headline indices for display (methodology, docs, the
 * API's self-describing registry): the market, the two real categories, and every
 * named IP in the catalog. The residual "other" buckets have valid tickers (V-OTH /
 * V-ETC) but aren't advertised here. Deterministic order = catalog order.
 */
export function indexRegistry(): IndexIdentity[] {
  return [
    identity("market", "total"),
    identity("category", "tcg"),
    identity("category", "sports"),
    ...IP_CATALOG.map((ip) => identity("ip", ip.key)),
  ];
}
