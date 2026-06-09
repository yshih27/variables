/**
 * Per-category gacha pack CATALOG — contract + a temporary PLACEHOLDER.
 *
 * Phygitals' pack store (see the design screenshots) is organized by CATEGORY
 * (Pokémon, One Piece, …); each category has named pack tiers, a stated buyback
 * rate, per-pack expected value, live payout odds, and a demo spin. Our warmed
 * data today (see `fetchGacha.ts`) is per-PLATFORM price tiers only — it has
 * none of the category split, names, art, EV, or odds.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BACKEND CONTRACT (the data/back-end chat fills this in):
 *   Replace the body of `getGachaCatalog()` with warmed data shaped as
 *   `GachaCatalog`. The UI (`GachaPackExplorer`) already consumes this exact
 *   shape and degrades gracefully:
 *     • `image == null`            → a tasteful placeholder pack art
 *     • `expectedValueUsd == null` → "coming soon"
 *     • `odds == null | []`        → "coming soon"
 *     • `demoSpinHref == null`     → demo CTA renders as "coming soon"
 *   So you can light the picker up field-by-field as each warmer lands.
 *
 * Until then, the placeholder below is transcribed from the store screenshots.
 * Pack tiers are REAL — no phantom 10k/20k. Pokémon caps at $5,000, One Piece
 * at $2,500 (per the platform's actual menu).
 * ─────────────────────────────────────────────────────────────────────────
 */
import { IP_CATALOG, type IPMeta } from "./ipCatalog";

/** Icon fields shaped for `<IPIcon>` (reuses the real IP brand art). */
export type GachaIcon = {
  name: string;
  short: string;
  color: string;
  logo?: string;
  iconBlendMode?: "normal" | "screen" | "lighten";
  emoji?: string;
};

/** One payout band of a pack's live odds. */
export type GachaOddsBucket = {
  /** Display label, e.g. "$45–$80". */
  rangeLabel: string;
  minUsd: number;
  maxUsd: number;
  /** Probability share, 0–1. */
  prob: number;
};

/** One pack tier within a category. */
export type GachaPackOption = {
  /** Catalog-unique id (React key + selection), e.g. "ph:pokemon:rookie". */
  id: string;
  /** Display name, e.g. "Rookie", "East Blue". */
  name: string;
  priceUsd: number;
  /** Pack art URL. null → UI renders a placeholder. */
  image?: string | null;
  /** Realized expected value per pack, USD. null → "coming soon". */
  expectedValueUsd?: number | null;
  /** Live payout odds, rarest→commonest or by band. null/[] → "coming soon". */
  odds?: GachaOddsBucket[] | null;
};

/** A category (IP) group of packs, e.g. Pokémon. */
export type GachaCategoryGroup = {
  /** Category key — maps to an IP where possible, e.g. "pokemon". */
  key: string;
  name: string;
  icon: GachaIcon;
  /** Stated buyback rate, 0–1 (e.g. 0.85). null if unknown. */
  buybackRate?: number | null;
  /** Optional note under the title, e.g. "All loose boxes are guaranteed unmapped." */
  note?: string | null;
  /** Pack tiers, cheapest→priciest. */
  packs: GachaPackOption[];
  /** Pack to preselect (screenshots default to a mid tier). Defaults to first. */
  featuredPackId?: string | null;
  /** Demo-spin link. null → CTA shows "coming soon". */
  demoSpinHref?: string | null;
};

export type GachaCatalog = {
  /** Platform this catalog belongs to (Phygitals for now). */
  platformKey: string;
  platformName: string;
  categories: GachaCategoryGroup[];
  /** True while this is screenshot-transcribed placeholder data, not warmed. */
  placeholder: boolean;
};

function iconFor(key: string): GachaIcon {
  const m: IPMeta | undefined = IP_CATALOG.find((i) => i.key === key);
  if (!m) return { name: key, short: key.slice(0, 2).toUpperCase(), color: "#888888" };
  return {
    name: m.name,
    short: m.short,
    color: m.color,
    logo: m.logo,
    iconBlendMode: m.iconBlendMode,
    emoji: m.emoji,
  };
}

/** Build pack options from [name, priceUsd] tuples, with everything we don't
 *  have yet left null so the UI shows honest "coming soon" states. */
function packs(prefix: string, tiers: Array<[string, number]>): GachaPackOption[] {
  return tiers.map(([name, priceUsd]) => ({
    id: `${prefix}:${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    priceUsd,
    image: null,
    expectedValueUsd: null,
    odds: null,
  }));
}

// ─── PLACEHOLDER (transcribed from the Phygitals store screenshots) ──────────
const PLACEHOLDER_CATALOG: GachaCatalog = {
  platformKey: "phygitals",
  platformName: "Phygitals",
  placeholder: true,
  categories: [
    {
      key: "pokemon",
      name: "Pokémon",
      icon: iconFor("pokemon"),
      buybackRate: 0.85,
      note: null,
      packs: packs("ph:pokemon", [
        ["Trainer", 10],
        ["Rookie", 25],
        ["Elite", 50],
        ["Sealed", 100],
        ["Legend", 250],
        ["Base Set", 500],
        ["Platinum", 500],
        ["Mythic", 1000],
        ["Black", 2500],
        ["Diamond", 5000], // category cap — NOT 10k/20k
      ]),
      featuredPackId: "ph:pokemon:rookie",
      demoSpinHref: null,
    },
    {
      key: "one_piece",
      name: "One Piece",
      icon: iconFor("one_piece"),
      buybackRate: 0.85,
      note: "All loose boxes are guaranteed unmapped.",
      packs: packs("ph:one_piece", [
        ["Starter", 25],
        ["Elite", 50],
        ["East Blue", 80],
        ["One Piece", 100],
        ["Legend", 250],
        ["Platinum", 500],
        ["Mythic", 1000],
        ["Black", 2500], // category cap
      ]),
      featuredPackId: "ph:one_piece:east-blue",
      demoSpinHref: null,
    },
  ],
};

/**
 * Returns the gacha pack catalog for the picker.
 * PLACEHOLDER for now — the back-end chat replaces this with warmed,
 * category-tagged data conforming to `GachaCatalog`.
 */
export function getGachaCatalog(): GachaCatalog {
  return PLACEHOLDER_CATALOG;
}
