import { PLATFORM_SOURCES } from "./sources";
import { tickerOf } from "@/lib/indices/naming";
import type { IPCategory } from "./ipCatalog";

/**
 * The collapsed rail's monograms — ONE source of truth for every tile.
 *
 * ⚠️ WHY THIS EXISTS AT ALL. The rail used to reuse `RailNode.short`, which is
 * `tickerOf` minus the "V-" prefix for market/categories/IPs and
 * `PlatformSource.short` for platforms. That yields three-character codes for
 * some nodes and ONE-character codes for others (Courtyard "C", Beezie "B"), so
 * a column of 36px tiles came out ragged and the one-letter tiles read as typos.
 * Monograms are a display concern of exactly one surface, so they get their own
 * table rather than bending `short`, which every venue badge in the app prints.
 *
 * ⚠️ EXACTLY TWO CHARACTERS (the ★ glyph aside, which is one by nature and is in
 * the allowed glyph set). `railCodeOf` enforces it on the fallback path too, so a
 * catalog addition can never quietly ship a three-character tile.
 */

/** Fixed nodes — pages, not series, so there is no SSOT to derive them from. */
export const RAIL_CODES = {
  market: "MK",
  stats: "ST",
  economics: "EC",
  report: "RP",
  watchlist: "★",
  status: "SY",
  gacha: "GC",
  // The two SECTION landings (nav r3): the collapsed rail's "Categories" and
  // "Platforms" headings become tiles that link, so icons mode keeps the path to
  // /ips and /platforms. Two letters like every other tile — a section is not a
  // different kind of thing at 36px.
  categories: "CT",
  platforms: "PL",
} as const;

/** Categories. Keyed by IPCategory so adding one is a compile error until named. */
const CATEGORY_CODE: Record<IPCategory, string> = {
  tcg: "TC",
  sports: "SP",
  other: "OT",
};

const PLATFORM_CODE: Record<string, string> = Object.fromEntries(
  PLATFORM_SOURCES.map((p) => [p.key, p.railCode]),
);

/**
 * Two characters from a name, when nothing better exists — first letter plus the
 * next consonant, so "Riftbound" is RF rather than RI and two IPs starting "Ri"
 * still differ. Uppercased, always length 2.
 */
function derive(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (letters.length <= 1) return (letters + "X").slice(0, 2);
  const rest = letters.slice(1);
  const consonant = [...rest].find((c) => !"AEIOU".includes(c));
  return letters[0] + (consonant ?? rest[0]);
}

/**
 * The tile monogram for a rail node.
 *
 * IPs come off the naming SSOT's ticker (V-PKM → PKM → PK) so a catalog rename
 * moves the rail with it; everything else is a lookup. The two-character
 * guarantee is enforced here, once, rather than trusted to each table.
 */
export function railCodeOf(
  kind: "fixed" | "category" | "ip" | "platform",
  key: string,
  fallbackName?: string,
): string {
  const raw =
    kind === "fixed"
      ? (RAIL_CODES as Record<string, string>)[key]
      : kind === "category"
        ? CATEGORY_CODE[key as IPCategory]
        : kind === "platform"
          ? PLATFORM_CODE[key]
          : tickerOf("ip", key).replace(/^V-/, "");
  if (!raw) return derive(fallbackName ?? key);
  // "★" is one glyph by nature and is in the allowed set; everything else is
  // trimmed or padded to exactly two so the column cannot go ragged.
  if (raw === "★") return raw;
  return raw.length === 2 ? raw : raw.length > 2 ? raw.slice(0, 2) : derive(fallbackName ?? raw);
}
