/**
 * Canonical IP metadata. The `match` function maps raw trait values to an
 * IP. Add new IPs as we discover their `Category` strings in incoming sales.
 *
 * Visual identity priority: logo (branded IPs) > emoji (sports/streetwear) > shortcode.
 */
export type IPMeta = {
  key: string;
  name: string;
  short: string;
  color: string;
  /** Path to a brand logo under /public/ip-logos/. Branded IPs only. */
  logo?: string;
  /**
   * CSS mix-blend-mode applied to the logo image. Use "screen" for assets
   * whose dark outline should disappear into the dark theme (e.g. a pokéball
   * with a black divider line — `screen` makes the black blend into the
   * background while keeping red / white intact).
   */
  iconBlendMode?: "normal" | "screen" | "lighten";
  /** Single emoji for sports / streetwear / other categories. */
  emoji?: string;
  /** Match raw trait values (case-insensitive substring) */
  patterns: string[];
};

// Order matters: more specific patterns must come before generic ones.
// First hit wins, so card-IP categories sit above sport categories.
export const IP_CATALOG: IPMeta[] = [
  // ─── Branded TCG IPs (logo-driven) ─────────────────────────────
  {
    key: "pokemon",
    name: "Pokémon",
    short: "PKM",
    color: "#3B4CCA",
    logo: "/ip-logos/pokemon.png",
    iconBlendMode: "screen", // dark outline blends into dark theme
    emoji: "⚡", // fallback if logo file is missing
    patterns: ["pokemon", "pokémon"],
  },
  {
    key: "one_piece",
    name: "One Piece",
    short: "OP",
    color: "#1B66B5",
    logo: "/ip-logos/one-piece.png",
    emoji: "🏴‍☠️",
    patterns: ["one piece", "onepiece"],
  },
  {
    key: "yugioh",
    name: "Yu-Gi-Oh!",
    short: "YGO",
    color: "#D62828",
    logo: "/ip-logos/yugioh.png",
    emoji: "🎴",
    patterns: ["yu-gi-oh", "yugioh", "yu gi oh"],
  },
  {
    key: "magic",
    name: "Magic: The Gathering",
    short: "MTG",
    color: "#a18cff",
    emoji: "🪄",
    patterns: ["magic: the gathering", " mtg "],
  },
  {
    key: "lorcana",
    name: "Disney / Lorcana",
    short: "DSN",
    color: "#ff4d8d",
    emoji: "✨",
    patterns: ["lorcana"],
  },
  {
    key: "dragon_ball",
    name: "Dragon Ball",
    short: "DBZ",
    color: "#FF8C00",
    emoji: "🐉",
    patterns: ["dragon ball", "dragonball"],
  },
  {
    key: "veefriends",
    name: "VeeFriends",
    short: "VFR",
    color: "#a18cff",
    emoji: "🎨",
    patterns: ["veefriends"],
  },

  // ─── Sealed wax / boxes (above sports so a "Topps Baseball Blaster Box" stays Sealed) ──
  {
    key: "wax",
    name: "Sealed Wax",
    short: "WAX",
    color: "#fdff8c",
    emoji: "📦",
    patterns: ["sealed products", "booster box", "blaster box", "mega box", "hobby box"],
  },

  // ─── Sports ─────────────────────────────────────────────────────
  {
    key: "basketball",
    name: "Basketball",
    short: "NBA",
    color: "#FF6B35",
    emoji: "🏀",
    patterns: ["basketball", "nba"],
  },
  {
    key: "baseball",
    name: "Baseball",
    short: "MLB",
    color: "#fdff8c",
    emoji: "⚾",
    patterns: ["baseball", "mlb"],
  },
  {
    key: "football",
    name: "Football (NFL)",
    short: "NFL",
    color: "#6cf48a",
    emoji: "🏈",
    patterns: ["football", "nfl"],
  },
  {
    key: "soccer",
    name: "Soccer",
    short: "SOC",
    color: "#6cf48a",
    emoji: "⚽",
    patterns: ["soccer"],
  },
  {
    key: "hockey",
    name: "Hockey",
    short: "NHL",
    color: "#5fa3ff",
    emoji: "🏒",
    patterns: ["hockey", "nhl"],
  },
  {
    key: "f1",
    name: "F1 / Racing",
    short: "F1",
    color: "#5fa3ff",
    emoji: "🏎️",
    patterns: [" f1 ", "formula 1"],
  },

  // ─── Streetwear / Comics ───────────────────────────────────────
  {
    key: "sneakers",
    name: "Sneakers",
    short: "SNK",
    color: "#ff4d8d",
    emoji: "👟",
    patterns: ["sneakers", "nike", "adidas", "jordan retro", "yeezy"],
  },
  {
    key: "comics",
    name: "Comics",
    short: "CMX",
    color: "#a18cff",
    emoji: "📚",
    patterns: ["comics", "marvel comic", "dc comic"],
  },
];

const OTHER: IPMeta = {
  key: "other",
  name: "Other",
  short: "ETC",
  color: "#707070",
  emoji: "•",
  patterns: [],
};

export function classifyIP(rawValues: (string | number | undefined)[]): IPMeta {
  const lowered = rawValues
    .filter((v): v is string | number => v != null)
    .map((v) => String(v).toLowerCase());
  for (const ip of IP_CATALOG) {
    for (const pattern of ip.patterns) {
      if (lowered.some((v) => v.includes(pattern))) return ip;
    }
  }
  return OTHER;
}

export { OTHER as OTHER_IP };
