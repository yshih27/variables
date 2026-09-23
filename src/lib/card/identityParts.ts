/**
 * THE CANONICAL IDENTITY PARTS — the ONE derivation of the set key, the card
 * number and the language an identity is keyed AND slugged on.
 *
 * ⚠️ WHY THIS FILE EXISTS. `identityKey` (src/lib/data/traits.ts) and
 * `identitySlug` (src/lib/card/identity.ts) must agree field for field, or one
 * card gets two keys under one URL (a fragment) or one key under two URLs (a
 * duplicate page). Before v4.2 they disagreed on purpose — the key used the RAW
 * set string and the RAW number, the slug used the canonical set key — and the
 * disagreement was the measured fragmentation the identity page had to disclose.
 * Now both call this, so the two can only move together.
 *
 * THE THREE RULES:
 *   set      `normalizeSetName(raw).key`, falling back to that normaliser's own
 *            mechanical slug when it judges the string junk. A junk set still
 *            names a bucket ("game" is a PSA label fragment spanning several
 *            1999 print runs) and keying it as ABSENT would pool every set the
 *            normaliser cannot place into one price. Nothing is lost, nothing is
 *            silently pooled.
 *   number   `normalizeCardNumber` — see that file for the padding/denominator
 *            rules.
 *   language the name's language, ELSE the one the set normaliser lifted out of
 *            the set string. ⚠️ THIS IS LOAD-BEARING, NOT A NICETY: the canonical
 *            set key folds "Pokemon Japanese Sv2a-Pokemon 151" and "Pokemon 151"
 *            onto `151`, so without the set-derived language the Japanese and the
 *            English Charizard ex #6 PSA 10 would become ONE identity and one
 *            price. The slug has carried this since 2026-09-14 (measured: the
 *            hero slug resolved to the Japanese card without it); the key carries
 *            it from v4.2, because that is the release where it starts to matter.
 */
import type { CardIdentityParts } from "@/lib/data/traits";
import { normalizeSetName } from "./setName";
import { normalizeCardNumber } from "./cardNumber";

/**
 * setName.ts tags → the display language `CardIdentityParts` uses.
 *
 * ⚠️ "en" IS DELIBERATELY ABSENT. English is the unmarked default: every English
 * card would otherwise grow a `language` field (and a trailing `/english` URL
 * segment that `parseIdentitySlug` does not accept), splitting each identity in
 * two depending on whether its venue happened to spell "English" in the set
 * string.
 */
const LANGUAGE_BY_TAG: Record<string, string> = { ja: "Japanese", ko: "Korean", zh: "Chinese" };

export type CanonicalIdentityParts = {
  /** Canonical set key, the raw set's mechanical slug, or null when there is no
   *  set string at all. */
  setKey: string | null;
  /** Canonical card number, or null when there is no number at all. */
  number: string | null;
  /** Display language ("Japanese"), or null for the unmarked default. */
  language: string | null;
};

/** The three canonical fields, from one row's identity parts. Pure, idempotent. */
export function canonicalIdentityParts(p: CardIdentityParts): CanonicalIdentityParts {
  const setId = p.set ? normalizeSetName(p.set) : null;
  return {
    setKey: setId ? setId.key ?? (setId.slug || null) : null,
    number: normalizeCardNumber(p.number),
    language: p.language ?? (setId?.language ? LANGUAGE_BY_TAG[setId.language] ?? null : null),
  };
}
