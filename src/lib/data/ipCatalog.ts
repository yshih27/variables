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
  /**
   * Set when the IP's tokens aren't indexed yet, so only its pack spend is read
   * (Collector Crypt's watch machines, Oct 2026). Pages print "—" for its resale,
   * market cap and holders — never a $0 we didn't measure — and show this note.
   */
  tokensNotIndexed?: string;
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
    // "pocket monster(s)" = the Japanese-market name carried by JP graded slabs.
    patterns: ["pokemon", "pokémon", "pocket monster"],
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
    // "magic the gathering" (no colon) is how CC/Phygitals name most MTG slabs;
    // " mtg " stays space-bounded so it can't match inside another word.
    patterns: ["magic: the gathering", "magic the gathering", " mtg "],
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
  {
    key: "riftbound",
    name: "Riftbound (LoL)",
    short: "RFT",
    color: "#c8963e",
    emoji: "⚔️",
    patterns: ["riftbound", "league of legends"],
  },

  // ─── NFT-native collectible brands (R7: promoted out of "other") ──────────
  // These carried the largest un-named clusters in the "other" bucket. Placed
  // ABOVE the sealed-wax entry so a branded "… Booster Box" keeps its brand
  // identity (Azuki/Pudgy sell sealed product too) instead of falling to WAX.
  {
    key: "azuki",
    name: "Azuki TCG",
    short: "AZK",
    color: "#E4002B", // Azuki red-bean red
    emoji: "🫘",
    patterns: ["azuki"],
  },
  {
    key: "moonbirds",
    name: "Moonbirds",
    short: "MOON",
    color: "#6E56CF",
    emoji: "🦉",
    patterns: ["moonbird"],
  },
  {
    key: "pudgy_penguins",
    name: "Pudgy Penguins",
    short: "PPG",
    color: "#4FB4FF",
    emoji: "🐧",
    // "pudgy" catches "Pudgy Penguins …" and "Vibes (Pudgy) TCG …"; "vibes" catches
    // the Vibes TCG cards that never say Pudgy (Collector Crypt labels them
    // Category "Vibes": 91 sat in Other on Oct 21 2026).
    patterns: ["pudgy", "vibes"],
  },
  {
    key: "nobody_sausage",
    name: "Nobody Sausage",
    short: "NSG",
    color: "#FF8FA3",
    emoji: "🌭",
    // Collector Crypt files these under its own Category "Nobody Sausage" (blind
    // boxes, set "Nobody Sausage Blind Box"): 433 sat in Other on Oct 21 2026.
    // Above Sealed Wax on purpose: a branded box keeps its brand.
    patterns: ["nobody sausage"],
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
    // American football. Classification checks `soccer` FIRST (CLASSIFY_ORDER
    // below), so a soccer card whose set says "football"/"footballers" never
    // lands here; what reaches this entry is American football only.
    patterns: ["football", "nfl"],
  },
  {
    key: "soccer",
    name: "Soccer",
    short: "SOC",
    color: "#6cf48a",
    emoji: "⚽",
    // Soccer, which much of the world calls football. The venue's own "Soccer"
    // label, plus markers that only soccer cards carry: governing bodies,
    // leagues and competitions, soccer-only products, and "footballers" (Topps
    // Finest UEFA "Prized Footballers"). No bare "world cup": hockey, rugby and
    // cricket have World Cups too.
    patterns: [
      "soccer",
      "fifa",
      "uefa",
      "ucl",
      "ucc",
      "premier league",
      "champions league",
      "europa league",
      "club competitions",
      "la liga",
      "laliga",
      "bundesliga",
      "serie a",
      "ligue 1",
      "eredivisie",
      "mls",
      "copa america",
      "merlin chrome",
      "topps merlin",
      "match attax",
      "footballers",
      "futbol",
      "fútbol",
    ],
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
    // Plus drivers by FULL name: venues file F1 cards under other sports
    // (Collector Crypt labels a 2010 Michael Schumacher "Soccer"). Never a bare
    // surname: Toni Schumacher was a German goalkeeper. Checked before soccer
    // and American football (CLASSIFY_ORDER).
    patterns: [
      " f1 ",
      "formula 1",
      "formula one",
      "michael schumacher",
      "mick schumacher",
      "ralf schumacher",
      "lewis hamilton",
      "max verstappen",
      "ayrton senna",
      "charles leclerc",
      "lando norris",
      "fernando alonso",
      "sebastian vettel",
      "kimi raikkonen",
      "kimi räikkönen",
      "niki lauda",
      "oscar piastri",
      "valtteri bottas",
      "daniel ricciardo",
      "alain prost",
      "nico rosberg",
      "jenson button",
      "kimi antonelli",
      "franco colapinto",
    ],
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
    key: "watches",
    name: "Watches",
    short: "WCH",
    color: "#C9A227",
    emoji: "⌚",
    // Brand phrases only. A bare "watch" would take the Pokémon Watchog and
    // Watchmen comics; a bare "omega", the "Omega Ruby" set.
    patterns: [
      "rolex",
      "patek philippe",
      "audemars piguet",
      "richard mille",
      "vacheron constantin",
      "jaeger-lecoultre",
      "omega speedmaster",
      "omega seamaster",
      "grand seiko",
      "tag heuer",
      "breitling",
      "hublot",
      "panerai",
      "luxury watch",
      "wristwatch",
    ],
    tokensNotIndexed:
      "Collector Crypt's watch machines are counted in pack spend; the watch tokens themselves aren't indexed yet, so this IP has no resale, market cap or holders here",
  },
  {
    key: "comics",
    name: "Comics",
    short: "CMX",
    color: "#a18cff",
    emoji: "📚",
    // Bare "marvel" (Marvel-branded cards are comics/entertainment). Checked after
    // every TCG/sports IP, so it only catches otherwise-unclassified cards.
    patterns: ["comics", "marvel", "dc comic"],
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

/**
 * Matching precedence: IP_CATALOG order, except that F1 and then soccer are
 * checked before American football. Both soccer and American football are
 * "football" somewhere, and the soccer markers are the specific ones; a named
 * F1 driver outranks whatever sport the venue filed the card under. IP_CATALOG
 * itself keeps its order (it is also the display order of indexRegistry and
 * the sitemap).
 */
const CLASSIFY_ORDER: IPMeta[] = (() => {
  // F1 drivers, then soccer, both ahead of American football: a named driver
  // outranks the venue's sport label, and soccer markers outrank "football".
  const ahead = ["f1", "soccer"];
  const lifted = ahead.map((k) => IP_CATALOG.find((i) => i.key === k)).filter((i): i is IPMeta => Boolean(i));
  const order = IP_CATALOG.filter((i) => !ahead.includes(i.key));
  const nfl = order.findIndex((i) => i.key === "football");
  order.splice(nfl >= 0 ? nfl : order.length, 0, ...lifted);
  return order;
})();

/**
 * A short code (≤4 letters/digits: nfl, nba, mlb, nhl, ucl, mls, nike) matches
 * as a whole word only; longer patterns match as substrings. Substring matching
 * on codes misfiled cards: "Star Trek Inflexions" contained "nfl" and sat under
 * Football (NFL).
 */
const SHORT_CODE = /^[a-z0-9]{1,4}$/;
const WORD_RE = new Map<string, RegExp>();
function hasPattern(value: string, pattern: string): boolean {
  if (!SHORT_CODE.test(pattern)) return value.includes(pattern);
  let re = WORD_RE.get(pattern);
  if (!re) {
    re = new RegExp(`(?:^|[^a-z0-9])${pattern}(?:$|[^a-z0-9])`);
    WORD_RE.set(pattern, re);
  }
  return re.test(value);
}

/**
 * Pattern-only matching: the IP whose pattern first hits a raw value, in
 * CLASSIFY_ORDER, else Other. Client-safe (no lexicons), so the browser's pack
 * matrix can name a pack's IP. Cards and sales go through `classifyIP` in
 * ipClassify.ts (server), which adds the character fallback on top of this.
 */
export function matchIPPatterns(rawValues: (string | number | undefined)[]): IPMeta {
  const lowered = rawValues
    .filter((v): v is string | number => v != null)
    .map((v) => String(v).toLowerCase());
  for (const ip of CLASSIFY_ORDER) {
    for (const pattern of ip.patterns) {
      if (lowered.some((v) => hasPattern(v, pattern))) return ip;
    }
  }
  return OTHER;
}



export { OTHER as OTHER_IP };

// ─────────────────────────── Category SSOT (B5) ───────────────────────────

export type IPCategory = "tcg" | "sports" | "other";

/** Canonical ipKey → category. Single source of truth for the category page. */
const CATEGORY_BY_IP: Record<string, IPCategory> = {
  pokemon: "tcg",
  one_piece: "tcg",
  yugioh: "tcg",
  magic: "tcg",
  lorcana: "tcg",
  dragon_ball: "tcg",
  azuki: "tcg", // Azuki TCG — a bona-fide trading-card game (starter decks / packs)
  riftbound: "tcg", // Riftbound — the League of Legends TCG
  basketball: "sports",
  baseball: "sports",
  football: "sports",
  soccer: "sports",
  hockey: "sports",
  f1: "sports",
  // veefriends / wax / sneakers / comics / moonbirds / pudgy_penguins /
  // nobody_sausage / watches → "other"
  // (NFT-native collectible brands & sealed product, not a TCG or sports league)
};

const _unmappedLogged = new Set<string>();

/**
 * Map an ipKey → its market category. An unmapped IP resolves to "other"
 * EXPLICITLY and logs once (never a silent misclassification). B5 SSOT — both
 * the indices roll-up and the frontend import this same map.
 */
export function categoryOf(ipKey: string): IPCategory {
  const c = CATEGORY_BY_IP[ipKey];
  if (c) return c;
  if (ipKey && ipKey !== "other" && !_unmappedLogged.has(ipKey)) {
    _unmappedLogged.add(ipKey);
    console.warn(`[ipCatalog] categoryOf: unmapped IP "${ipKey}" → "other"`);
  }
  return "other";
}

/** All ipKeys in a category (for the cap-weighted roll-up). */
export function ipsInCategory(category: IPCategory): string[] {
  return Object.keys(CATEGORY_BY_IP).filter((k) => CATEGORY_BY_IP[k] === category);
}
