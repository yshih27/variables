/**
 * Cheap, synchronous key-validity checks used by `proxy.ts` to reject unknown
 * IP / platform / card URLs BEFORE rendering (so they get a real 404 instead of
 * a soft 404 — see the note in proxy.ts). Pure in-memory lookups; no I/O.
 */
import { IP_CATALOG, OTHER_IP } from "@/lib/data/ipCatalog";
import { PLATFORM_SOURCES } from "@/lib/data/sources";
import { parseCardId } from "@/lib/card/ids";

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
