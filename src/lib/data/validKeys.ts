/**
 * Cheap, synchronous key-validity checks used by `proxy.ts` to reject unknown
 * IP / platform / card URLs BEFORE rendering (so they get a real 404 instead of
 * a soft 404 — see the note in proxy.ts). Pure in-memory lookups; no I/O.
 */
import { IP_CATALOG, OTHER_IP } from "@/lib/data/ipCatalog";
import { PLATFORM_SOURCES } from "@/lib/data/sources";
import { parseCardId } from "@/lib/card/ids";
import { parseIdentitySlug } from "@/lib/card/identity";
import { hasCharacterExtractor } from "@/lib/card/character";

const IP_KEYS = new Set<string>([...IP_CATALOG.map((i) => i.key), OTHER_IP.key]);
const PLATFORM_KEYS = new Set<string>(PLATFORM_SOURCES.map((s) => s.key));

export function isValidIpKey(key: string): boolean {
  return IP_KEYS.has(key);
}

export function isValidPlatformKey(key: string): boolean {
  return PLATFORM_KEYS.has(key);
}

/** Card validity here is format-only (platform prefix + tokenId). A
 *  format-valid id that doesn't actually exist still 404s via the page's own
 *  notFound(), just as a soft 404 — true existence needs an async lookup that's
 *  too heavy for the proxy. */
export function isValidCardId(id: string): boolean {
  return parseCardId(id) !== null;
}

/** Identity validity is format-only, like a card's: five to seven well-formed
 *  segments (`/i/<ip>/<set>/<number>/<name>/<grade>[/<edition>][/<lang>]`) is
 *  the parser's rule, so a four-segment or malformed slug is a real 404 here.
 *  A well-formed slug that names no identity still 404s via the page's own
 *  notFound() — existence needs the reader. */
export function isValidIdentityPath(pathname: string): boolean {
  return parseIdentitySlug(pathname) !== null;
}

/**
 * `/ip/<key>/characters[/<character>]` — the character pages exist only for an
 * IP with a character extractor, and a character page is exactly ONE more
 * segment in the rollup key's charset (`charizard`, `monkey-d-luffy`). Any
 * other shape under `/characters` is a real 404 here; a well-formed key the
 * snapshot does not hold still 404s via the page's own notFound().
 */
export function isValidCharacterPath(parts: string[]): boolean {
  // parts = ["ip", <key>, "characters", ...rest]
  const [, key, sub, ...rest] = parts;
  if (sub !== "characters") return true;
  if (!hasCharacterExtractor(key)) return false;
  if (rest.length === 0) return true;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rest[0])) return false;
  // The character, alone — or followed by Next's own metadata image route
  // (`…/charizard/opengraph-image`), which lives one segment deeper.
  return rest.length === 1 || (rest.length === 2 && /^(opengraph|twitter)-image(-[a-z0-9]+)?$/.test(rest[1]));
}
