import { tickerOf, indexDisplayName } from "./naming";
import { PREMIUM_PAIRS } from "@/lib/data/gradePremium";

/**
 * Blob id → what to call it, and where it lives.
 *
 * ⚠️ THE NAMES COME FROM THE NAMING SSOT, NOT FROM HERE. `tickerOf` and
 * `indexDisplayName` learned `grade` and `set` in the backend WP, so
 * `grade:psa-10` is V-PSA10 and `set:pokemon:151` is V-151 with no second
 * derivation on this side. What this module still owns is the SHAPE of an id —
 * splitting `set:<ip>:<key>` into its two halves — and the route an entity maps
 * to, both of which are frontend concerns.
 *
 * ⚠️ FROM THE KEY, NEVER FROM A TYPED LIST. The rail's flyouts and the command
 * palette enumerate whatever `grade:` / `set:` entities the blob actually holds,
 * so an entity that clears its floor appears everywhere at once and one that is
 * auto-held disappears everywhere at once.
 */

export type IndexEntityKind = "market" | "category" | "ip" | "grade" | "set" | "premium";

export type EntityLabel = {
  /** The blob id, verbatim — `grade:psa-10`. */
  id: string;
  kind: IndexEntityKind;
  /** The `entity` half for readIndexSeries. */
  entity: string;
  /** The `key` half — for a set this is `<ip>:<set_key>`, colon included. */
  key: string;
  ticker: string;
  /** Short human name — "PSA 10", "151". */
  name: string;
  /** Where this entity's own page lives, when it has one. */
  href: string | null;
};

/** Split a blob id once, on its first colon. */
function split(id: string): { entity: string; key: string } {
  const i = id.indexOf(":");
  return i < 0 ? { entity: id, key: "" } : { entity: id.slice(0, i), key: id.slice(i + 1) };
}

/** The pair behind a `premium:<a>:<b>` id, when the site publishes that pair. */
export function pairOfPremiumId(id: string) {
  return PREMIUM_PAIRS.find((p) => p.id === id) ?? null;
}

/**
 * The IP a `set:` id belongs to, and the set key under it. `set:pokemon:151` →
 * `{ ip: "pokemon", setKey: "151" }`.
 *
 * ⚠️ THE SET SLUG IS THE BACKEND'S KEY, VERBATIM. `/ip/pokemon/sets/151` is the
 * route, not `/…/pokemon-151`: re-deriving a slug on this side would be a second
 * naming rule that could drift from the one the blob and `cards.set_key` share.
 */
export function ipOfSetId(id: string): string | null {
  const { entity, key } = split(id);
  if (entity !== "set") return null;
  const j = key.indexOf(":");
  return j < 0 ? null : key.slice(0, j);
}

export function setKeyOfId(id: string): string | null {
  const { entity, key } = split(id);
  if (entity !== "set") return null;
  const j = key.indexOf(":");
  return j < 0 ? key : key.slice(j + 1);
}

/**
 * Label any blob id. Total — an id the app has never seen still resolves to a
 * derived code and a title-cased name rather than throwing inside a rail.
 */
export function labelFor(id: string): EntityLabel {
  const { entity, key } = split(id);

  if (entity === "grade") {
    return {
      id, kind: "grade", entity, key,
      ticker: tickerOf("grade", key),
      // "The Varible PSA 10 Index" → "PSA 10": the rail and the tables want the
      // noun, not the full family name.
      name: bareName(indexDisplayName("grade", key)),
      href: null, // grades are market-wide; their page is per-IP
    };
  }

  if (entity === "set") {
    const ip = ipOfSetId(id);
    const setKey = setKeyOfId(id);
    return {
      id, kind: "set", entity, key,
      ticker: tickerOf("set", key),
      // "The Varible Pokémon 151 Index" → "Pokémon 151" — the IP-qualified name
      // the naming SSOT builds, which is exactly what the palette entry should
      // read ("Pokémon 151") and what a rail flyout row needs to be unambiguous.
      name: bareName(indexDisplayName("set", key)) || setKey || key,
      href: ip && setKey ? `/ip/${ip}/sets/${setKey}` : null,
    };
  }

  if (entity === "premium") {
    const pair = pairOfPremiumId(id);
    return {
      id, kind: "premium", entity, key,
      ticker: `V-${key.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)}`,
      name: pair ? pair.label : key.replace(":", " / "),
      href: null,
    };
  }

  return {
    id,
    kind: (entity as IndexEntityKind) ?? "ip",
    entity,
    key,
    ticker: tickerOf(entity === "category" ? "category" : entity === "market" ? "market" : "ip", key),
    name: bareName(indexDisplayName(entity === "category" ? "category" : entity === "market" ? "market" : "ip", key)),
    href: entity === "ip" ? `/ip/${key}` : null,
  };
}

/** "The Varible PSA 10 Index" → "PSA 10". */
function bareName(display: string): string {
  return display.replace(/^The Varible\s+/, "").replace(/\s+Index$/, "");
}
