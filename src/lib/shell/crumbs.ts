import type { RailModel } from "@/lib/types";
import { IP_CATALOG, OTHER_IP } from "@/lib/data/ipCatalog";
import { PLATFORM_SOURCES } from "@/lib/data/sources";
import { parseCardId, PLATFORM_META } from "@/lib/card/ids";

/**
 * The breadcrumb trail — ONE derivation from the pathname, for every page under
 * /ip, /platform, /ips, /platforms and /card.
 *
 * ⚠️ NAMES COME FROM THE RAIL MODEL, NEVER FROM A TYPED LIST. The trail shows the
 * same words the rail shows, because it is built from the same object the rail
 * is built from (`crumbNamesFrom(model)`). A page that spelt "Pokémon" one way in
 * its rail and another in its crumb would be two navigations disagreeing about
 * where the reader is.
 *
 * ⚠️ THE RAIL MODEL IS ALREADY FETCHED. AppShell reads it once per window for the
 * rail; the crumb consumes that same object through context. Zero new reads, by
 * construction rather than by discipline.
 *
 * The trail is `Categories › Pokémon › Sets › 151` — the IP sits directly under
 * Categories, not under its category (TCG). That is the brief's shape and it
 * matches how the rail reads: a category row is a disclosure, the IP is the
 * destination.
 */

export type Crumb = {
  label: string;
  href: string;
  /** The last segment: rendered as text, not a link — it is where the reader is. */
  current: boolean;
};

export type CrumbNames = {
  ips: Record<string, string>;
  platforms: Record<string, string>;
  /** Keyed `<ip>:<set_key>` — only sets the rail model knows (published indices). */
  sets: Record<string, string>;
};

/** The rail model, projected to the three lookups a crumb needs. */
export function crumbNamesFrom(model: RailModel | null | undefined): CrumbNames {
  const ips: Record<string, string> = {};
  const platforms: Record<string, string> = {};
  const sets: Record<string, string> = {};
  if (model) {
    for (const c of model.categories) for (const ip of c.ips) ips[ip.key] = ip.name;
    for (const c of model.categories) {
      for (const s of c.sets) {
        // A set node's href already names both halves: /ip/<ip>/sets/<set_key>.
        const m = /^\/ip\/([^/]+)\/sets\/([^/]+)$/.exec(s.href);
        if (!m) continue;
        // The rail names a set IP-qualified ("Pokémon 151") so a flyout row is
        // unambiguous. Under `Categories › Pokémon › Sets ›` the qualifier would
        // repeat the crumb before it, so the IP's OWN name is stripped — by exact
        // prefix match against the model, never by guessing at word boundaries.
        const ipName = ips[m[1]];
        const bare = ipName && s.name.startsWith(`${ipName} `) ? s.name.slice(ipName.length + 1) : s.name;
        sets[`${m[1]}:${m[2]}`] = bare;
      }
    }
    for (const p of model.platforms) platforms[p.key] = p.name;
  }
  return { ips, platforms, sets };
}

/**
 * The static catalogs the rail model is itself built from — the fallback when no
 * model is in context (the flag-off shell, which never mounts AppShell). Same
 * spellings, same source, no read.
 */
export function crumbNamesFromCatalog(): CrumbNames {
  return {
    ips: Object.fromEntries([...IP_CATALOG, OTHER_IP].map((i) => [i.key, i.name])),
    platforms: Object.fromEntries(PLATFORM_SOURCES.map((p) => [p.key, p.name])),
    sets: {},
  };
}

/** Sub-page nouns under an IP or a venue. Route segments, not copy. */
const IP_LEAF: Record<string, string> = { cards: "Cards", grades: "Grades", sets: "Sets" };
const PLATFORM_LEAF: Record<string, string> = { ips: "IPs", sales: "Sales", cards: "Cards" };

/**
 * The trail for a pathname. Returns [] for a route the trail does not cover, so a
 * caller can mount `<Breadcrumbs>` unconditionally.
 *
 * `leaf` names the final segment when the page knows it better than the model
 * does — a set with no published index, or a card — and is still data, not copy.
 */
export function crumbsFor(pathname: string, names: CrumbNames, leaf?: string | null): Crumb[] {
  const parts = pathname.split("/").filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const [root, key, sub, rest] = parts;

  if (root === "ips") return finish([{ label: "Categories", href: "/ips" }]);
  if (root === "platforms") return finish([{ label: "Platforms", href: "/platforms" }]);

  if (root === "ip" && key) {
    const trail = [
      { label: "Categories", href: "/ips" },
      { label: names.ips[key] ?? leafOr(leaf, key), href: `/ip/${key}` },
    ];
    if (sub && IP_LEAF[sub]) {
      trail.push({ label: IP_LEAF[sub], href: `/ip/${key}/${sub}` });
      if (sub === "sets" && rest) {
        trail.push({ label: names.sets[`${key}:${rest}`] ?? leafOr(leaf, rest), href: `/ip/${key}/sets/${rest}` });
      }
    }
    return finish(trail);
  }

  if (root === "platform" && key) {
    const trail = [
      { label: "Platforms", href: "/platforms" },
      { label: names.platforms[key] ?? leafOr(leaf, key), href: `/platform/${key}` },
    ];
    if (sub && PLATFORM_LEAF[sub]) trail.push({ label: PLATFORM_LEAF[sub], href: `/platform/${key}/${sub}` });
    return finish(trail);
  }

  if (root === "card" && key) {
    // A card knows its VENUE from its own id; it does not know its IP key (only a
    // display category), so the trail hangs it under Platforms rather than
    // guessing a Categories path that could point at the wrong IP.
    const parsed = parseCardId(key);
    const platform = parsed?.platform ?? null;
    const platformName = platform
      ? names.platforms[platform] ?? PLATFORM_META[platform]?.label ?? platform
      : null;
    const trail: Omit<Crumb, "current">[] = [{ label: "Platforms", href: "/platforms" }];
    if (platform && platformName) trail.push({ label: platformName, href: `/platform/${platform}` });
    trail.push({ label: leaf?.trim() || "Card", href: pathname });
    return finish(trail);
  }

  return [];
}

/** The page's own name for the segment, else the slug — never invented. */
function leafOr(leaf: string | null | undefined, slug: string): string {
  return leaf?.trim() || slug;
}

function finish(trail: Omit<Crumb, "current">[]): Crumb[] {
  return trail.map((c, i) => ({ ...c, current: i === trail.length - 1 }));
}
