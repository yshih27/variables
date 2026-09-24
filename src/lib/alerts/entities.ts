/**
 * What a watch is ON — an identity slug, an ip key or a platform key — resolved
 * to its label and its page from the naming SSOTs, never shown as a raw key.
 */
import { IP_CATALOG } from "@/lib/data/ipCatalog";
import { PLATFORM_SOURCES } from "@/lib/data/sources";
import { identityHref, identityDisplayName, canonicalIdentitySlug, parseIdentitySlug } from "@/lib/card/identity";
import { parseIdentityKey } from "@/lib/data/traits";
import { canonicalGrade } from "@/lib/data/gradePremium";
import type { AlertEntityType, EntityRef } from "./signals";

/** "Charizard ex · PSA 10" — the identity page's title form, from its key. */
export function identityLabelFromKey(key: string): string | null {
  const pk = parseIdentityKey(key);
  if (!pk?.parts.cardName) return null;
  return `${identityDisplayName(pk.parts.cardName)} · ${canonicalGrade(pk.parts.grade)}`;
}

/**
 * Resolve a watch target, or null when it names nothing we track. Identity
 * slugs are canonicalised (an old v4.1 URL still resolves) and checked against
 * the slug index (`slugKeys`), so a watch can never be stored on a page that
 * does not exist.
 */
export function resolveEntity(type: AlertEntityType, rawKey: string, slugKeys?: (slug: string) => string[] | undefined): EntityRef | null {
  const key = rawKey.trim();
  if (type === "ip") {
    const ip = IP_CATALOG.find((i) => i.key === key);
    return ip ? { type, key, label: ip.name, href: `/ip/${key}` } : null;
  }
  if (type === "platform") {
    const p = PLATFORM_SOURCES.find((s) => s.key === key);
    return p ? { type, key, label: p.name, href: `/platform/${key}` } : null;
  }
  const parsed = parseIdentitySlug(key);
  if (!parsed) return null;
  const slug = canonicalIdentitySlug(parsed.slug) ?? parsed.slug;
  const keys = slugKeys?.(slug);
  if (slugKeys && !keys?.length) return null;
  const label = (keys && identityLabelFromKey(keys[0])) ?? `${identityDisplayName(parsed.nameSlug.replace(/-/g, " "))} · ${parsed.gradeSlug.toUpperCase().replace(/-/g, " ")}`;
  return { type, key: slug, label, href: identityHref(slug) };
}
