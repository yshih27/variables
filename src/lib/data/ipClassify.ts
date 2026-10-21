/**
 * IP classification for cards, sales and holdings — SERVER SIDE.
 *
 * `classifyIP` = the catalog's patterns (`matchIPPatterns`, ipCatalog.ts), then,
 * only when nothing matched, the character fallback below. The fallback reads the
 * Pokémon species lexicon (1,025 names) and the One Piece roster, which is why it
 * lives here and not in ipCatalog.ts: the catalog is imported by client
 * components and the proxy for IP names and colours, and must not ship the
 * lexicons to the browser (measured Oct 21 2026: a 61 KB client chunk).
 * The browser's pack matrix uses `matchIPPatterns` directly.
 */
import { POKEMON_SPECIES } from "../card/pokemonSpecies";
import { ONE_PIECE_ALIASES } from "../card/character";
import { IP_CATALOG, OTHER_IP, matchIPPatterns, type IPMeta } from "./ipCatalog";

export function classifyIP(rawValues: (string | number | undefined)[]): IPMeta {
  const matched = matchIPPatterns(rawValues);
  if (matched.key !== OTHER_IP.key) return matched;
  const lowered = rawValues
    .filter((v): v is string | number => v != null)
    .map((v) => String(v).toLowerCase());
  return characterFallback(lowered) ?? OTHER_IP;
}

// ── Character fallback: only when no pattern matched ─────────────────────────
// Cards that name no franchise still name a character: Collector Crypt tokens
// whose metadata is a bare title ("2022 #015 Radiant Charizard PSA"), Renaiss
// cards titled by the card alone ("Latias Delta Species · Holon Research
// Tower"), One Piece slabs a venue files under "Collectible Card Games"
// ("2024 #OP05-060 Monkey.D.Luffy"). Measured Oct 21 2026: ~900 such cards sat
// in Other. Runs AFTER every pattern, so it never overrides a positive match.
// Matches are whole words over a normalised title (lower case, no diacritics,
// punctuation as space).
// One Piece card codes: OP05-060, OP05069, EB01-001, PRB01-001, ST10-001. A
// Digimon "ST1-01" does not fit (two digits, dash, three digits).
const OP_CODE = /(?:^|[^a-z0-9])(?:(?:op|eb|prb)\d{2}-?\d{3}|st\d{2}-\d{3})(?:$|[^a-z0-9])/;
// One Piece names: the roster's multi-word aliases, plus single names that are
// nobody else's. Single aliases like "law", "ace", "robin", "dragon", "killer"
// are ordinary words and stay out, and so does bare "zoro": Collector Crypt cuts
// titles at 32 characters, and "…Hisuian Zoro" is a Zoroark ("Roronoa Zoro" stays).
const OP_SINGLE_NAMES = ["luffy", "sanji", "usopp", "jinbe", "jinbei", "kaido", "kaidou", "whitebeard", "doflamingo", "katakuri", "newgate", "akainu", "aokiji", "kizaru", "arlong", "ivankov", "bartolomeo"];
// Species names that are English words or athletes' surnames ("Kevin Durant"),
// and the shortest names, never decide a card on their own.
const SPECIES_STOP = new Set(["persian", "electrode", "golem", "ditto", "gloom", "jynx", "muk", "abra", "natu", "seel", "klink", "aron", "durant"]);

function normTitle(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’‘`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function wordAlternation(words: Iterable<string>): RegExp {
  const esc = [...new Set(words)].filter(Boolean).sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?:^| )(?:${esc.join("|")})(?:$| )`);
}
let FALLBACK: { op: RegExp; pkm: RegExp } | null = null;
function fallbackRegexes(): { op: RegExp; pkm: RegExp } {
  if (FALLBACK) return FALLBACK;
  const opNames = [
    ...OP_SINGLE_NAMES,
    ...ONE_PIECE_ALIASES.flatMap(([, name, ...aliases]) => [name, ...aliases]).map((a) => normTitle(a.toLowerCase())).filter((a) => a.includes(" ") && a.length >= 7),
  ];
  // Regional-form words are Pokémon's alone ("Hisuian Zoroark", "Galarian Moltres").
  const species = [...POKEMON_SPECIES.map((s) => normTitle(s.name.toLowerCase())).filter((n) => !SPECIES_STOP.has(n)), "hisuian", "galarian", "alolan", "paldean"];
  FALLBACK = { op: wordAlternation(opNames), pkm: wordAlternation(species) };
  return FALLBACK;
}
function characterFallback(lowered: string[]): IPMeta | null {
  const ipFor = (key: string) => IP_CATALOG.find((i) => i.key === key) ?? null;
  // Card codes keep their dash, so test the raw (lower-cased) values.
  if (lowered.some((v) => OP_CODE.test(v))) return ipFor("one_piece");
  const titles = lowered.map(normTitle).filter(Boolean);
  const { op, pkm } = fallbackRegexes();
  if (titles.some((t) => op.test(t))) return ipFor("one_piece");
  if (titles.some((t) => pkm.test(t))) return ipFor("pokemon");
  return null;
}

// ── Structured TCG-attribute fallbacks (for classifyIPFromMeta) ──────────────
// Ungraded slabs often name themselves by CARD + SET ("Dugtrio Obsidian Flames")
// with no franchise keyword, so keyword matching alone defaults them to "other"
// (this stranded ~9.5K Phygitals holders). The on-chain metadata still carries a
// `Set ID` / `Card Id` / `Type`, which pins the franchise. Only consulted AFTER
// keyword matching returns "other", so it can't override a positive keyword hit.
const OP_SETID_RE = /^(op|eb|prb|st)\d/; // One Piece TCG set codes (OP01-, EB0-, ST0-, PRB0-)
// Pokémon set-id era prefixes + SV-era 3-letter set codes.
const PKM_SETID_RE =
  /^(sv|svp|swsh|sm|xy|bw|dp|hgss|pl|col|ex|base|gym|neo|dpp|pop|np|mcd|cel|pgo|paf|mew|obf|dri|jtg|ssp|sfa|scr|pre|tef|twm|rsv)/;
const PKM_TYPE_RE = /pok[eé�.]?mon/i; // "Pokémon" Type — the é often arrives mojibake'd
const PKM_SUPERTYPES = new Set(["trainer", "energy", "supporter", "stadium", "item"]);

type MetaLike = {
  name?: string | null;
  attributes?: Array<{ trait_type?: unknown; value?: unknown }> | null;
};

/**
 * Classify from structured token metadata: keyword-match over name+attribute
 * VALUES first (same as classifyIP), then a TCG structured-attribute fallback for
 * the ungraded cards keyword matching misses. Conservative — the fallback only
 * fires when keywords yield "other", and each rule needs a real TCG set-id/type.
 */
export function classifyIPFromMeta(meta: MetaLike): IPMeta {
  const attrs = meta.attributes ?? [];
  const hints = [meta.name, ...attrs.map((a) => (a?.value == null ? "" : String(a.value)))].filter(
    (v): v is string => Boolean(v),
  );
  const base = classifyIP(hints);
  if (base.key !== "other") return base;

  const byTrait = new Map<string, string>();
  for (const a of attrs) {
    if (a?.trait_type != null && a?.value != null) byTrait.set(String(a.trait_type).toLowerCase(), String(a.value).toLowerCase());
  }
  const type = byTrait.get("type") ?? "";
  const setId = byTrait.get("set id") ?? "";
  const anyId = setId || byTrait.get("card id") || "";
  const ipFor = (key: string) => IP_CATALOG.find((i) => i.key === key) ?? OTHER_IP;
  if (OP_SETID_RE.test(anyId)) return ipFor("one_piece");
  if (PKM_TYPE_RE.test(type)) return ipFor("pokemon");
  if (PKM_SUPERTYPES.has(type) && anyId) return ipFor("pokemon");
  if (PKM_SETID_RE.test(setId)) return ipFor("pokemon");
  return OTHER_IP;
}
