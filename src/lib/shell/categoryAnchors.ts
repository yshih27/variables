import type { IPCategory } from "@/lib/data/ipCatalog";

/**
 * The `/ips#<category>` anchors — one list, shared by the server page that
 * places the anchor targets and the client component that reacts to the hash.
 *
 * ⚠️ IN A PLAIN MODULE ON PURPOSE. A value exported from a "use client" file
 * reaches a server component as a client-reference proxy, not an array — the
 * first cut put this beside CategoryLanding and `/ips` threw
 * "CATEGORY_KEYS.map is not a function" at render. Typed against IPCategory so a
 * new category is a compile error here until it gets an anchor.
 */
export const CATEGORY_ANCHORS: readonly IPCategory[] = ["tcg", "sports", "other"];

/** How long the landing pulse stays on the category's tiles and rows. */
export const LANDING_MS = 1200;
