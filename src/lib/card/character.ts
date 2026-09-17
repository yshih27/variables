/**
 * CHARACTER — the ONE extractor from a card name to the character it depicts.
 *
 *   characterOf("pokemon", "2025 MEGA CHARIZARD X EX #13 PHANTASMAL FLAMES")
 *     → { key: "charizard", name: "Charizard", partners: [], facets: { form: "Mega X" } }
 *   characterOf("one_piece", "2025 MONKEY.D.LUFFY (FOIL) #14 EX GEAR 5")
 *     → { key: "monkey-d-luffy", name: "Monkey D. Luffy", partners: [], facets: { form: "Gear 5" } }
 *
 * Third module of the card-name family, after identity.ts (the URL) and
 * setName.ts (the set), and it follows setName.ts's discipline: the measured
 * shapes are in this header, every fold is in an explicit table, and it does
 * NOT feed the identity key.
 *
 * ⚠️ THE NAME IS DIRTY, MEASURED NOT ASSUMED (2026-09-17, production identity
 * index: 49,417 Pokémon and 2,332 One Piece identities). Year, set, number,
 * grade and edition LEAK INTO THE NAME for several sources — 187 distinct
 * strings contain CHARIZARD and 269 contain PIKACHU, arriving as `CHARIZARD` ·
 * `CHARIZARD EX` · `CHARIZARD #6` · `2023 CHARIZARD EX #6 151` · `2024 PIKACHU
 * PALDEAN FATES #018` · `1999 POKEMON JUNGLE PIKACHU #60` · `2004 #040 PIKACHU
 * PSA 10` · `1ST EDITION CHARIZARD P` · `BASE SET HOLO CHARIZARD` · `BLAINE'S
 * CHARIZARD-HOLO` · `BLASTOISE/CHARIZARD` · `CHARIZARD & BRAIXEN GX` · `ASH &
 * PIKACHU-PRISM` · `CAPTAIN PIKACHU` · `3RD PLACE PIKACHU`. So a
 * strip-everything-else rule cannot work — after stripping there is still
 * "PALDEAN FATES" or "BREAKTHROUGH" left — and Pokémon is matched against a
 * LEXICON instead: the 1,025 species (src/lib/card/pokemonSpecies.ts, generated
 * from PokéAPI), longest match first on a folded token stream, and everything
 * that is not a species is left alone. Modifier tokens by count: HOLO 1,848 ·
 * FULL ART 1,488 · EX 979 · REVERSE 721 · FOIL 567 · GX 501 · V 435 · DARK 229 ·
 * VMAX 215 · PROMO 213 · TEAM 154 · M 139 · STAR 119 · MEGA 119 · LV.X 114 ·
 * SHINING 109 · GOLD 87 · VSTAR 86 · GALARIAN 68 · PALDEAN 62 · ALOLAN 52 ·
 * HISUIAN 46. Owner prefixes: ROCKET'S 108 · TEAM ROCKET'S 48 · MISTY'S 47 ·
 * ERIKA'S 44 · GIOVANNI'S 42 · LT. SURGE'S 42 · SABRINA'S 40 · BLAINE'S 36 ·
 * BROCK'S 33 · KOGA'S 20 · TEAM AQUA'S 19 · TEAM MAGMA'S 18.
 *
 * One Piece is the opposite shape — 433 distinct names, a closed cast, no
 * lexicon to buy — so it is STRIP + ALIAS TABLE: `MONKEY D. LUFFY` · `MONKEY D
 * LUFFY PAR/(CHAMPIONSHIP SET 2022)` · `2025 MONKEY.D.LUFFY (FOIL) #14 EX GEAR
 * 5` · `MONKEY D. LUFFY (GEAR 5)` · `MONKEY D. LUFFY P` / ` S` / ` AL` · `DON!!
 * - MONKEY D. LUFFY` · `LUFFY` · `LUFFY-TAROU ALT ART SP` · `LUFFY
 * C/(CHAMPIONSHIP` · `ACE & SABO & LUFFY` · `"SHIP DOCTOR" CHOPPER` · `ANDROID
 * 18/FRANKY` · `LUFFY WILL BECOME KING OF THE PIRATES!!!` (an event card, not a
 * character). Year, `#NN`, the `DON!! - ` prefix, quoted epithets,
 * parenthesised and rarity tails come off in that order; what remains is looked
 * up in `ONE_PIECE_ALIASES`, and a name not in the table keeps its own key (an
 * unrecognised character still gets a rollup, the way an unrecognised set
 * keeps its own set key). Event and slogan cards are OUT: a `!` in the
 * remainder, a name longer than four words with no alias hit, or a known stage
 * / event name → null, reported, not guessed.
 *
 * Other IPs (sports players, comics, Yu-Gi-Oh) → null in this version. The
 * interface takes `ip` so a players lexicon slots in without touching a call
 * site.
 *
 * ⚠️ THIS DOES NOT FEED `identityKey` OR `identitySlug`. The identity still
 * keys on the raw name (src/lib/data/traits.ts) and the published index levels
 * must not move. `characterOf` GROUPS identities into a rollup; it never
 * re-keys one. Only `key` drives the rollup; `name` is its display form,
 * `facets` are display-only and best-effort, `partners` are the other
 * characters on a multi-character card (a Charizard & Braixen card is on both
 * pages).
 *
 * Pure. No I/O. Never throws.
 */
import { POKEMON_SPECIES } from "./pokemonSpecies";

export type CharacterMatch = {
  /** Lowercase ASCII slug that names the rollup: "charizard", "monkey-d-luffy". */
  key: string;
  /** Display form: "Charizard", "Mr. Mime", "Monkey D. Luffy". */
  name: string;
  /** The other characters on a multi-character card, display form, in name order. */
  partners: string[];
  /** The partners' rollup keys, aligned with `partners`; null for a crossover
   *  guest that resolves to no character of this IP ("Android 18"). */
  partnerKeys: (string | null)[];
  /** Display-only, best-effort. Nothing here changes `key`. */
  facets: {
    /** "Blaine", "Team Rocket", "Misty" — the `<X>'S ` prefix. */
    owner?: string;
    /** "Mega", "Mega X", "Galarian", "Dark", "Shining", "Gear 5". */
    form?: string;
    /** "Flying", "Surfing", "Captain", "With Grey Felt Hat", "DON!!". */
    variant?: string;
  };
};

// ── shared folding ───────────────────────────────────────────────────────────

/** NFKD, strip diacritics, upper-case: "Flabébé" → "FLABEBE", "Pokémon" → "POKEMON".
 *  One HTML entity survives in the feeds ("MAGIKARP &AMP; WAILORD", "KID &AMP;
 *  KILLER" — measured); it is the join, so it is decoded here for both IPs. */
function fold(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/&AMP;/g, "&");
}

const APOSTROPHE = /['’‘`´]/g;

function titleize(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function slugify(s: string): string {
  return fold(s)
    .toLowerCase()
    .replace(APOSTROPHE, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Pokémon: the lexicon ─────────────────────────────────────────────────────

/**
 * A species' match form: the same folding the card name gets, so "Mr. Mime"
 * and "MR MIME" / "MR. MIME" meet at ["MR", "MIME"], "Farfetch’d" and
 * "FARFETCHD" at ["FARFETCHD"], "Ho-Oh" at ["HO", "OH"], "Type: Null" at
 * ["TYPE", "NULL"], "Porygon-Z" at ["PORYGON", "Z"] (which beats ["PORYGON"]
 * because the longest match wins).
 */
function matchTokens(s: string): string[] {
  return fold(s).replace(APOSTROPHE, "").replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

type Species = { key: string; name: string; tokens: string[] };

/**
 * Spellings the fold alone does not reach, added on top of the lexicon. The
 * gendered Nidorans are rewritten BEFORE tokenising (see `pokemonTokens`), so
 * they always arrive as NIDORAN F / NIDORAN M whichever glyph the source used.
 */
const POKEMON_SPELLINGS: [string[], string][] = [
  [["NIDORAN", "F"], "nidoran-f"],
  [["NIDORAN", "M"], "nidoran-m"],
  [["FARFETCH", "D"], "farfetchd"],
  [["SIRFETCH", "D"], "sirfetchd"],
  [["PORYGON", "2"], "porygon2"],
  [["PORYGONZ"], "porygon-z"],
  [["MRMIME"], "mr-mime"],
  [["MIMEJR"], "mime-jr"],
  [["HOOH"], "ho-oh"],
  [["TYPENULL"], "type-null"],
];

/** first token → candidate species, longest token sequence first. */
const SPECIES_BY_FIRST: Map<string, Species[]> = (() => {
  const byKey = new Map(POKEMON_SPECIES.map((s) => [s.key, s]));
  const all: Species[] = POKEMON_SPECIES.map((s) => ({ key: s.key, name: s.name, tokens: matchTokens(s.name) }));
  for (const [tokens, key] of POKEMON_SPELLINGS) {
    const sp = byKey.get(key);
    if (sp) all.push({ key, name: sp.name, tokens });
  }
  const m = new Map<string, Species[]>();
  for (const sp of all) {
    if (!sp.tokens.length) continue;
    const a = m.get(sp.tokens[0]);
    if (a) a.push(sp);
    else m.set(sp.tokens[0], [sp]);
  }
  for (const a of m.values()) a.sort((x, y) => y.tokens.length - x.tokens.length);
  return m;
})();

/** Connector between two characters on one card. */
const JOIN = "+";
/** Possessive marker kept through the fold: "BLAINE'S" → "BLAINES~". */
const POSS = "~";

/**
 * The card name as a token stream. Apostrophes go (FARFETCH'D → FARFETCHD)
 * except a possessive `'S`, which leaves its mark; `&`, `/` and ` AND ` become
 * the join token; everything else that is not a letter or digit is a space —
 * so "CHARIZARD-HOLO" splits, "HO-OH" splits into the two tokens the lexicon
 * holds, and "#6" is just "6".
 */
function pokemonTokens(name: string): string[] {
  let s = fold(name);
  s = s.replace(/NIDORAN\s*(?:♀|\(F\)|FEMALE|F)(?![A-Z0-9])/g, "NIDORAN F").replace(/NIDORAN\s*(?:♂|\(M\)|MALE|M)(?![A-Z0-9])/g, "NIDORAN M");
  // The set code "Mew EN-151" leaks into three CC-truncated names ("2023
  // POKEMON MEW EN-151 #038 NIN", measured) — that MEW is a set, not the card.
  s = s.replace(/\bMEW\s+EN-?\s*151\b/g, " 151 ");
  // A parenthesised tail is a description, not a name — "(MOVIE 2001)",
  // "/(RAYQUAZA PONCHO-WEARING PIKACHU SPECIAL BOX)" (measured): the species
  // inside it is a box, not a co-star. Balanced or truncated.
  s = s.replace(/\([^)]*\)?/g, " ");
  s = s.replace(/['’‘`´]S(?![A-Z0-9])/g, `S${POSS}`).replace(APOSTROPHE, "");
  s = s.replace(/\s+AND\s+/g, ` ${JOIN} `).replace(/[&/]/g, ` ${JOIN} `);
  return s.replace(new RegExp(`[^A-Z0-9${POSS}${JOIN}]+`, "g"), " ").trim().split(" ").filter(Boolean);
}

type Hit = { sp: Species; at: number; len: number };

/** Every species in the stream, left to right, longest match first at each position. */
function findSpecies(tokens: string[]): Hit[] {
  const hits: Hit[] = [];
  for (let i = 0; i < tokens.length; ) {
    const cands = SPECIES_BY_FIRST.get(tokens[i]);
    let hit: Hit | null = null;
    if (cands) {
      for (const sp of cands) {
        if (sp.tokens.every((t, k) => tokens[i + k] === t)) {
          hit = { sp, at: i, len: sp.tokens.length };
          break; // longest first
        }
      }
    }
    if (hit) {
      hits.push(hit);
      i += hit.len;
    } else i++;
  }
  return hits;
}

const FORM_PREFIX: Record<string, string> = {
  MEGA: "Mega",
  M: "Mega",
  GALARIAN: "Galarian",
  ALOLAN: "Alolan",
  HISUIAN: "Hisuian",
  PALDEAN: "Paldean",
  DARK: "Dark",
  LIGHT: "Light",
  SHINING: "Shining",
  RADIANT: "Radiant",
  TERA: "Tera",
};
const VARIANT_PREFIX: Record<string, string> = {
  FLYING: "Flying",
  SURFING: "Surfing",
  BIRTHDAY: "Birthday",
  CAPTAIN: "Captain",
  DETECTIVE: "Detective",
  COSPLAY: "Cosplay",
};
/** Owners whose fold loses punctuation or whose display is not a plain title case. */
const OWNER_DISPLAY: Record<string, string> = { "LT SURGE": "Lt. Surge", "TEAM ROCKET": "Team Rocket", "TEAM AQUA": "Team Aqua", "TEAM MAGMA": "Team Magma", "TEAM GALACTIC": "Team Galactic" };
/** A token that joins the possessive to a two-word owner: TEAM ROCKET'S, LT. SURGE'S. */
const OWNER_LEAD = new Set(["TEAM", "LT", "DR", "PROFESSOR", "PROF"]);
/** Where a "WITH …" variant stops. */
const VARIANT_STOP = new Set(["EX", "GX", "V", "VMAX", "VSTAR", "HOLO", "PROMO", "PSA", "BGS", "CGC", "SGC", "TAG", "REVERSE", "FOIL", "FULL", "ART", JOIN]);

function pokemonCharacter(name: string): CharacterMatch | null {
  const tokens = pokemonTokens(name);
  const hits = findSpecies(tokens);
  if (!hits.length) return null;
  const first = hits[0];
  const facets: CharacterMatch["facets"] = {};

  // Prefixes, walking back from the species: forms, variants, then the owner.
  let i = first.at - 1;
  const forms: string[] = [];
  while (i >= 0) {
    const t = tokens[i];
    if (FORM_PREFIX[t]) { forms.unshift(FORM_PREFIX[t]); i--; continue; }
    if (VARIANT_PREFIX[t]) { facets.variant ??= VARIANT_PREFIX[t]; i--; continue; }
    if (t.endsWith(POSS)) {
      let owner = t.slice(0, -2); // drop the "S~" the possessive left
      if (i > 0 && OWNER_LEAD.has(tokens[i - 1])) owner = `${tokens[i - 1]} ${owner}`;
      facets.owner = OWNER_DISPLAY[owner] ?? titleize(owner);
    }
    break;
  }
  // Mega X / Mega Y: the letter follows the species.
  const after = tokens[first.at + first.len];
  if (forms.includes("Mega") && (after === "X" || after === "Y")) forms[forms.indexOf("Mega")] = `Mega ${after}`;
  if (forms.length) facets.form = forms.join(" ");

  // Suffix variants: "PIKACHU WITH GREY FELT HAT", "DEOXYS EX TEAM PLASMA".
  const rest = tokens.slice(first.at + first.len);
  const w = rest.indexOf("WITH");
  if (w >= 0 && !facets.variant) {
    const phrase: string[] = ["WITH"];
    for (const t of rest.slice(w + 1, w + 5)) {
      if (VARIANT_STOP.has(t) || /^\d/.test(t)) break;
      phrase.push(t);
    }
    if (phrase.length > 1) facets.variant = titleize(phrase.join(" "));
  }
  for (let k = 0; k + 1 < rest.length; k++) if (rest[k] === "TEAM" && rest[k + 1] === "PLASMA") facets.variant ??= "Team Plasma";

  // Partners: further species joined to the previous one by &, / or AND only.
  // A second species with anything else between them is left alone — it is a
  // set name or a mention, not a co-star.
  const partners: string[] = [];
  const partnerKeys: (string | null)[] = [];
  let prev = first;
  for (const h of hits.slice(1)) {
    const between = tokens.slice(prev.at + prev.len, h.at);
    if (between.includes(JOIN) && between.every((t) => t === JOIN || VARIANT_STOP.has(t))) {
      partners.push(h.sp.name);
      partnerKeys.push(h.sp.key);
      prev = h;
    } else break;
  }
  return { key: first.sp.key, name: first.sp.name, partners, partnerKeys, facets };
}

// ── One Piece: strip + alias table ───────────────────────────────────────────

/**
 * Canonical key, display name, then EVERY alias folded into it, in the
 * normalised form the lookup compares (upper-case, no diacritics, punctuation
 * → space): "MONKEY.D.LUFFY", "MONKEY D. LUFFY" and "MONKEY D LUFFY" all
 * arrive as "MONKEY D LUFFY", so one entry covers the three spellings. Listed
 * in full, like setName.ts lists its collapses, so a fold is a reviewable line
 * and not a rule. A name absent from this table keeps its own key.
 */
export const ONE_PIECE_ALIASES: readonly [key: string, name: string, ...aliases: string[]][] = [
  ["monkey-d-luffy", "Monkey D. Luffy", "MONKEY D LUFFY", "LUFFY", "LUFFY TAROU", "LUFFYTARO", "LUFFYTAROU", "MONKEY D LUFFY GEAR 5", "STRAW HAT LUFFY", "SUN GOD NIKA", "NIKA"],
  ["roronoa-zoro", "Roronoa Zoro", "RORONOA ZORO", "ZORO", "ZOROJURO", "ZORO JURO", "ZORO JUUROU", "ZOROJUUROU", "RORONOA ZORO ZOROJURO", "RORONORA ZORO"],
  ["nami", "Nami", "NAMI", "ONAMI", "O NAMI"],
  ["usopp", "Usopp", "USOPP", "USOHACHI", "USO HACHI", "GOD USOPP", "SOGEKING"],
  ["sanji", "Sanji", "SANJI", "VINSMOKE SANJI", "SANGORO"],
  ["tony-tony-chopper", "Tony Tony Chopper", "TONY TONY CHOPPER", "TONYTONY CHOPPER", "CHOPPER", "CHOPPEREMON"],
  ["nico-robin", "Nico Robin", "NICO ROBIN", "ROBIN", "OROBI", "O ROBI", "MISS ALL SUNDAY", "MS ALL SUNDAY"],
  ["franky", "Franky", "FRANKY", "FRANOSUKE", "FRA NOSUKE", "CUTTY FLAM"],
  ["brook", "Brook", "BROOK", "HONEKICHI", "SOUL KING BROOK"],
  ["jinbe", "Jinbe", "JINBE", "JIMBEI", "JINBEI"],
  ["portgas-d-ace", "Portgas D. Ace", "PORTGAS D ACE", "ACE", "PORTGAS ACE"],
  ["sabo", "Sabo", "SABO"],
  ["edward-newgate", "Edward Newgate", "EDWARD NEWGATE", "NEWGATE", "WHITEBEARD"],
  ["shanks", "Shanks", "SHANKS", "RED HAIRED SHANKS", "RED HAIR SHANKS"],
  ["trafalgar-law", "Trafalgar Law", "TRAFALGAR LAW", "LAW", "TRAFALGAR D WATER LAW"],
  ["kaido", "Kaido", "KAIDO", "KAIDOU"],
  ["charlotte-linlin", "Charlotte Linlin", "CHARLOTTE LINLIN", "BIG MOM", "LINLIN"],
  ["donquixote-doflamingo", "Donquixote Doflamingo", "DONQUIXOTE DOFLAMINGO", "DOFLAMINGO", "DOFFY"],
  ["yamato", "Yamato", "YAMATO"],
  ["boa-hancock", "Boa Hancock", "BOA HANCOCK", "HANCOCK"],
  ["sakazuki", "Sakazuki", "SAKAZUKI", "AKAINU"],
  ["kuzan", "Kuzan", "KUZAN", "AOKIJI"],
  ["borsalino", "Borsalino", "BORSALINO", "KIZARU"],
  ["issho", "Issho", "ISSHO", "FUJITORA"],
  ["aramaki", "Aramaki", "ARAMAKI", "RYOKUGYU"],
  ["buggy", "Buggy", "BUGGY", "BUGGY THE CLOWN"],
  ["crocodile", "Crocodile", "CROCODILE", "SIR CROCODILE", "MR 0"],
  ["enel", "Enel", "ENEL", "ENERU"],
  ["charlotte-katakuri", "Charlotte Katakuri", "CHARLOTTE KATAKURI", "KATAKURI"],
  ["donquixote-rosinante", "Donquixote Rosinante", "DONQUIXOTE ROSINANTE", "ROSINANTE", "CORAZON"],
  ["dracule-mihawk", "Dracule Mihawk", "DRACULE MIHAWK", "MIHAWK"],
  ["monkey-d-garp", "Monkey D. Garp", "MONKEY D GARP", "GARP"],
  ["monkey-d-dragon", "Monkey D. Dragon", "MONKEY D DRAGON", "DRAGON"],
  ["silvers-rayleigh", "Silvers Rayleigh", "SILVERS RAYLEIGH", "RAYLEIGH"],
  ["koby", "Koby", "KOBY", "COBY"],
  ["smoker", "Smoker", "SMOKER"],
  ["nefeltari-vivi", "Nefeltari Vivi", "NEFELTARI VIVI", "NEFERTARI VIVI", "VIVI"],
  ["rebecca", "Rebecca", "REBECCA"],
  ["perona", "Perona", "PERONA"],
  ["gol-d-roger", "Gol D. Roger", "GOL D ROGER", "ROGER", "GOLD ROGER"],
  ["marshall-d-teach", "Marshall D. Teach", "MARSHALL D TEACH", "TEACH", "BLACKBEARD"],
  ["eustass-kid", "Eustass Kid", "EUSTASS KID", "EUSTASS CAPTAIN KID", "KID", "EUSTASS KIDD"],
  ["killer", "Killer", "KILLER", "HITOKIRI KAMAZO", "KAMAZO"],
  ["kozuki-oden", "Kozuki Oden", "KOZUKI ODEN", "ODEN"],
  ["kozuki-momonosuke", "Kozuki Momonosuke", "KOZUKI MOMONOSUKE", "KOUZUKI MOMONOSUKE", "MOMONOSUKE"],
  ["kinemon", "Kin'emon", "KINEMON", "KIN EMON"],
  ["marco", "Marco", "MARCO"],
  ["uta", "Uta", "UTA"],
  ["vinsmoke-reiju", "Vinsmoke Reiju", "VINSMOKE REIJU", "REIJU"],
  ["vinsmoke-judge", "Vinsmoke Judge", "VINSMOKE JUDGE", "JUDGE"],
  ["bartholomew-kuma", "Bartholomew Kuma", "BARTHOLOMEW KUMA", "KUMA"],
  ["gecko-moria", "Gecko Moria", "GECKO MORIA", "MORIA", "GEKKO MORIA"],
  ["rob-lucci", "Rob Lucci", "ROB LUCCI", "LUCCI"],
  ["kaku", "Kaku", "KAKU"],
  ["jewelry-bonney", "Jewelry Bonney", "JEWELRY BONNEY", "BONNEY"],
  ["x-drake", "X Drake", "X DRAKE", "DRAKE"],
  ["basil-hawkins", "Basil Hawkins", "BASIL HAWKINS", "HAWKINS"],
  ["scratchmen-apoo", "Scratchmen Apoo", "SCRATCHMEN APOO", "APOO"],
  ["capone-bege", "Capone Bege", "CAPONE BEGE", "CAPONE GANG BEGE", "BEGE"],
  ["urouge", "Urouge", "UROUGE"],
  ["emporio-ivankov", "Emporio Ivankov", "EMPORIO IVANKOV", "IVANKOV"],
  ["hody-jones", "Hody Jones", "HODY JONES", "HODY"],
  ["arlong", "Arlong", "ARLONG"],
  ["caesar-clown", "Caesar Clown", "CAESAR CLOWN", "CAESAR"],
  ["vergo", "Vergo", "VERGO"],
  ["sengoku", "Sengoku", "SENGOKU"],
  ["tsuru", "Tsuru", "TSURU"],
  ["tashigi", "Tashigi", "TASHIGI"],
  ["hina", "Hina", "HINA"],
  ["king", "King", "KING"],
  ["queen", "Queen", "QUEEN"],
  ["jack", "Jack", "JACK"],
  ["whos-who", "Who's-Who", "WHOS WHO", "WHO S WHO"],
  ["ulti", "Ulti", "ULTI"],
  ["page-one", "Page One", "PAGE ONE"],
  ["black-maria", "Black Maria", "BLACK MARIA"],
  ["sasaki", "Sasaki", "SASAKI"],
  ["charlotte-cracker", "Charlotte Cracker", "CHARLOTTE CRACKER", "CRACKER"],
  ["charlotte-perospero", "Charlotte Perospero", "CHARLOTTE PEROSPERO", "PEROSPERO"],
  ["charlotte-smoothie", "Charlotte Smoothie", "CHARLOTTE SMOOTHIE", "SMOOTHIE"],
  ["charlotte-pudding", "Charlotte Pudding", "CHARLOTTE PUDDING", "PUDDING"],
  ["magellan", "Magellan", "MAGELLAN"],
  ["shiryu", "Shiryu", "SHIRYU"],
  ["benn-beckman", "Benn Beckman", "BENN BECKMAN", "BECKMAN"],
  ["yasopp", "Yasopp", "YASOPP"],
  ["lucky-roux", "Lucky Roux", "LUCKY ROUX", "LUCKY ROO"],
  ["carrot", "Carrot", "CARROT"],
  ["pedro", "Pedro", "PEDRO"],
  ["otama", "Otama", "OTAMA", "O TAMA", "TAMA"],
  ["hiyori", "Hiyori", "HIYORI", "KOZUKI HIYORI", "KOMURASAKI"],
  ["izo", "Izo", "IZO", "IZOU"],
  ["vista", "Vista", "VISTA"],
  ["jozu", "Jozu", "JOZU"],
  ["shirahoshi", "Shirahoshi", "SHIRAHOSHI"],
  ["fisher-tiger", "Fisher Tiger", "FISHER TIGER"],
  ["koala", "Koala", "KOALA"],
  ["stussy", "Stussy", "STUSSY"],
  ["sentomaru", "Sentomaru", "SENTOMARU"],
  ["vegapunk", "Vegapunk", "VEGAPUNK", "DR VEGAPUNK"],
  ["gild-tesoro", "Gild Tesoro", "GILD TESORO", "TESORO"],
  ["zephyr", "Zephyr", "ZEPHYR", "Z"],
  ["shiki", "Shiki", "SHIKI"],
  ["douglas-bullet", "Douglas Bullet", "DOUGLAS BULLET", "BULLET"],
  ["kureha", "Kureha", "KUREHA", "DR KUREHA", "DOCTOR KUREHA"],
  ["wapol", "Wapol", "WAPOL"],
  ["gan-fall", "Gan Fall", "GAN FALL"],
  ["wyper", "Wyper", "WYPER"],
  ["foxy", "Foxy", "FOXY"],
  ["iceburg", "Iceburg", "ICEBURG"],
  ["paulie", "Paulie", "PAULIE"],
  ["spandam", "Spandam", "SPANDAM"],
  ["jabra", "Jabra", "JABRA"],
  ["kalifa", "Kalifa", "KALIFA"],
  ["blueno", "Blueno", "BLUENO"],
  ["absalom", "Absalom", "ABSALOM"],
  ["hogback", "Hogback", "HOGBACK", "DR HOGBACK"],
  ["ryuma", "Ryuma", "RYUMA"],
  ["lola", "Lola", "LOLA"],
  ["camie", "Camie", "CAMIE", "KEIMI"],
  ["hatchan", "Hatchan", "HATCHAN", "HACHI"],
  ["bartolomeo", "Bartolomeo", "BARTOLOMEO"],
  ["cavendish", "Cavendish", "CAVENDISH"],
  ["bellamy", "Bellamy", "BELLAMY"],
  ["kyros", "Kyros", "KYROS"],
  ["viola", "Viola", "VIOLA"],
  ["sugar", "Sugar", "SUGAR"],
  ["pica", "Pica", "PICA"],
  ["trebol", "Trebol", "TREBOL"],
  ["diamante", "Diamante", "DIAMANTE"],
  ["senor-pink", "Senor Pink", "SENOR PINK"],
  ["baby-5", "Baby 5", "BABY 5"],
  ["monet", "Monet", "MONET"],
  ["bon-clay", "Bon Clay", "BON CLAY", "BENTHAM", "MR 2 BON CLAY", "MR 2 BON KUREI", "MR 2 BON KUREI BENTHAM", "MR 2"],
  ["mr-1", "Mr. 1", "MR 1", "DAZ BONES", "DAZ BONEZ"],
  ["mr-3", "Mr. 3", "MR 3", "GALDINO"],
  ["miss-doublefinger", "Miss Doublefinger", "MISS DOUBLEFINGER", "MISS DOUBLE FINGER"],
  ["kohza", "Kohza", "KOHZA", "KOZA"],
  ["pell", "Pell", "PELL"],
  ["chaka", "Chaka", "CHAKA"],
  ["nefeltari-cobra", "Nefeltari Cobra", "NEFELTARI COBRA", "COBRA"],
  ["dorry", "Dorry", "DORRY"],
  ["brogy", "Brogy", "BROGY"],
  ["hajrudin", "Hajrudin", "HAJRUDIN"],
  ["sai", "Sai", "SAI"],
  ["leo", "Leo", "LEO"],
  ["orlumbus", "Orlumbus", "ORLUMBUS"],
  ["ideo", "Ideo", "IDEO"],
  ["inuarashi", "Inuarashi", "INUARASHI"],
  ["nekomamushi", "Nekomamushi", "NEKOMAMUSHI"],
  ["raizo", "Raizo", "RAIZO"],
  ["kanjuro", "Kanjuro", "KANJURO", "KUROZUMI KANJURO"],
  ["denjiro", "Denjiro", "DENJIRO"],
  ["kawamatsu", "Kawamatsu", "KAWAMATSU"],
  ["ashura-doji", "Ashura Doji", "ASHURA DOJI"],
  ["kurozumi-orochi", "Kurozumi Orochi", "KUROZUMI OROCHI", "OROCHI"],
  ["hyogoro", "Hyogoro", "HYOGORO"],
  ["toki", "Toki", "TOKI", "KOZUKI TOKI"],
  ["gordon", "Gordon", "GORDON"],
  ["belo-betty", "Belo Betty", "BELO BETTY"],
  ["karasu", "Karasu", "KARASU"],
  ["lindbergh", "Lindbergh", "LINDBERGH"],
  ["morley", "Morley", "MORLEY"],
  ["hack", "Hack", "HACK"],
  ["ain", "Ain", "AIN"],
  ["binz", "Binz", "BINZ"],
  ["baccarat", "Baccarat", "BACCARAT"],
  ["carina", "Carina", "CARINA"],
  ["nojiko", "Nojiko", "NOJIKO"],
  ["genzo", "Genzo", "GENZO"],
  ["kaya", "Kaya", "KAYA"],
  ["makino", "Makino", "MAKINO"],
  ["dadan", "Dadan", "DADAN", "CURLY DADAN"],
  ["zeff", "Zeff", "ZEFF", "RED LEG ZEFF"],
  ["kuro", "Kuro", "KURO", "CAPTAIN KURO"],
  ["krieg", "Krieg", "KRIEG", "DON KRIEG"],
  ["gin", "Gin", "GIN"],
  ["alvida", "Alvida", "ALVIDA"],
  ["morgan", "Morgan", "MORGAN", "AXE HAND MORGAN"],
  ["helmeppo", "Helmeppo", "HELMEPPO"],
  ["saul", "Jaguar D. Saul", "JAGUAR D SAUL", "SAUL"],
  ["nico-olvia", "Nico Olvia", "NICO OLVIA", "OLVIA"],
  ["rocks-d-xebec", "Rocks D. Xebec", "ROCKS D XEBEC", "XEBEC", "ROCKS"],
  ["scopper-gaban", "Scopper Gaban", "SCOPPER GABAN", "GABAN"],
  ["shakuyaku", "Shakuyaku", "SHAKUYAKU", "SHAKKY"],
  ["s-snake", "S-Snake", "S SNAKE"],
  ["s-hawk", "S-Hawk", "S HAWK"],
  ["s-bear", "S-Bear", "S BEAR"],
  ["s-shark", "S-Shark", "S SHARK"],
  ["saturn", "Saint Jaygarcia Saturn", "SAINT JAYGARCIA SATURN", "ST JAYGARCIA SATURN", "JAYGARCIA SATURN", "SATURN"],
  ["shepherd-ju-peter", "Saint Shepherd Ju Peter", "SAINT SHEPHERD JU PETER", "ST SHEPHERD JU PETER", "SHEPHERD JU PETER", "JU PETER"],
  ["marcus-mars", "Saint Marcus Mars", "SAINT MARCUS MARS", "ST MARCUS MARS", "MARCUS MARS"],
  ["topman-warcury", "Saint Topman Warcury", "SAINT TOPMAN WARCURY", "ST TOPMAN WARCURY", "TOPMAN WARCURY", "WARCURY"],
  ["ethanbaron-v-nusjuro", "Saint Ethanbaron V. Nusjuro", "SAINT ETHANBARON V NUSJURO", "ST ETHANBARON V NUSJURO", "ETHANBARON V NUSJURO", "NUSJURO"],
  ["kikunojo", "Kikunojo", "KIKUNOJO", "OKIKU", "O KIKU", "KIKU"],
  ["zeus", "Zeus", "ZEUS"],
  ["laboon", "Laboon", "LABOON"],
  ["lim", "Lim", "LIM"],
  ["lilith", "Lilith", "LILITH"],
  ["edison", "Edison", "EDISON"],
  ["hibari", "Hibari", "HIBARI"],
  ["hongo", "Hongo", "HONGO"],
  ["charlotte-flampe", "Charlotte Flampe", "CHARLOTTE FLAMPE", "FLAMPE"],
  ["edward-weevil", "Edward Weevil", "EDWARD WEEVIL", "WEEVIL"],
  ["kujaku", "Kujaku", "KUJAKU", "KUJYAKU"],
  ["pacifista", "Pacifista", "PACIFISTA"],
  ["megalo", "Megalo", "MEGALO"],
  ["sadi", "Sadi", "SADI", "LITTLE SADI", "SADI CHAN"],
  ["mansherry", "Mansherry", "MANSHERRY"],
  ["general-franky", "General Franky", "GENERAL FRANKY"],
  ["imu", "Imu", "IMU"],
  ["van-augur", "Van Augur", "VAN AUGUR"],
  ["jesus-burgess", "Jesus Burgess", "JESUS BURGESS", "BURGESS"],
  ["doc-q", "Doc Q", "DOC Q"],
  ["laffitte", "Laffitte", "LAFFITTE"],
  ["avalo-pizarro", "Avalo Pizarro", "AVALO PIZARRO"],
  ["catarina-devon", "Catarina Devon", "CATARINA DEVON"],
  ["sanjuan-wolf", "Sanjuan Wolf", "SANJUAN WOLF", "SAN JUAN WOLF"],
  ["vasco-shot", "Vasco Shot", "VASCO SHOT"],
  ["oars", "Oars", "OARS", "LITTLE OARS JR", "OARS JR"],
  ["hannyabal", "Hannyabal", "HANNYABAL"],
  ["inazuma", "Inazuma", "INAZUMA"],
  ["kalgara", "Kalgara", "KALGARA"],
];

/** Alias (normalised) → { key, name }. */
const OP_ALIAS_INDEX: Map<string, { key: string; name: string }> = (() => {
  const m = new Map<string, { key: string; name: string }>();
  for (const [key, name, ...aliases] of ONE_PIECE_ALIASES) {
    for (const a of aliases) m.set(a, { key, name });
    m.set(opNormalise(name), { key, name });
  }
  return m;
})();

/**
 * Not characters: stages and the event cards that get graded. Conservative
 * on purpose — a wrong entry hides one card from one page, a missing entry
 * is visible in the report as a character nobody recognises.
 */
const OP_NOT_CHARACTERS = new Set([
  // stages
  "THOUSAND SUNNY", "GOING MERRY", "MOBY DICK", "BARATIE", "ONIGASHIMA", "ALABASTA", "ALABASTA KINGDOM", "WANO", "WANO COUNTRY",
  "MARINEFORD", "IMPEL DOWN", "EGGHEAD", "ARLONG PARK", "WATER SEVEN", "ENIES LOBBY", "THRILLER BARK", "DRESSROSA",
  "WHOLE CAKE ISLAND", "PUNK HAZARD", "SABAODY ARCHIPELAGO", "AMAZON LILY", "FISH MAN ISLAND", "SKYPIEA", "DRUM KINGDOM",
  "LOGUETOWN", "SHELLS TOWN", "ORANGE TOWN", "SYRUP VILLAGE", "FOOSHA VILLAGE", "JAYA", "LITTLE GARDEN", "WHISKEY PEAK",
  "REVERSE MOUNTAIN", "ZOU", "KURAIGANA ISLAND", "MARY GEOISE", "MARIEJOIS", "RED LINE", "GRAND LINE", "NEW WORLD", "LAUGH TALE",
  "ELBAF", "FLOWER CAPITAL", "UDON", "KURI", "MARINE HEADQUARTERS", "NAVY HEADQUARTERS", "RED FORCE", "POLAR TANG", "QUEEN MAMA CHANTER",
  "GERMA KINGDOM", "TOTTO LAND", "HITSUGIBUNE", "SUNNY GO", "MERRY GO", "MT CORVO", "WINDMILL VILLAGE",
  // blanks and non-characters measured in the data
  "CARD", "INSERT ART CARD", "SUPER", "GIRL", "ONE PIECE", "FIVE ELDERS", "CROSS GUILD", "PREMIUM POWER PRO", "SECRET BOX", "GEAR TWO", "GEAR THREE", "GEAR FOUR", "GEAR FIVE",
  "GEAR SECOND", "GEAR THIRD", "GEAR FOURTH", "GEAR FIFTH", "THE MYSTERIOUS WOMAN THIEF", "THREE THOUSAND WORLDS", "BOEUF BURST",
  "HONESTY IMPACT", "GROUND DEATH", "YOULL FRIGHTEN ME", "GUM GUM GIANT", "GUM GUM JET GATLING", "GUM GUM RAIN",
  // events
  "GUM GUM PISTOL", "GUM GUM RED ROC", "GUM GUM JET PISTOL", "GUM GUM KING KONG GUN", "GUM GUM KONG GUN", "GUM GUM BAJRANG GUN",
  "DIABLE JAMBE", "HELL MEMORIES", "THUNDER BAGUA", "RADICAL BEAM", "ICE AGE", "MAGMA FIST", "FIRE FIST", "GUARD POINT",
  "THREE SWORD STYLE", "ELEPHANT GUN", "THUNDER LANCE TEMPO", "GRAVITY BLADE", "ROOM", "SHAMBLES", "GAMMA KNIFE",
  "DESERT SPADA", "DEATH WINK", "GALAXY IMPACT", "DIVINE DEPARTURE", "TSUNAMI", "PARTY TABLE KICK COURSE", "HAKI", "CONQUERORS HAKI",
  "SPECIAL ATTACK", "ONE FOR ALL", "BLACK MARIA S", "STRAW HAT PIRATES", "ROGER PIRATES", "WHITEBEARD PIRATES", "BIG MOM PIRATES",
  "RED HAIR PIRATES", "BEAST PIRATES", "HEART PIRATES", "KID PIRATES", "BLACKBEARD PIRATES", "REVOLUTIONARY ARMY", "CP9", "CP0",
]);

/** "PSA 10", "BGS 9.5", "BGS 10 BLACK LABEL" — 340 One Piece identities carry
 *  the GRADE as their name (measured 2026-09-17: a feed column defect upstream
 *  of the identity). Not a character, on no page, reported. */
const GRADE_LABEL = /^(?:PSA|BGS|CGC|SGC|TAG|AGS|CSG|PCA|BECKETT)\s*\d+(?:\s*[. ]\s*\d+)?(?:\s+(?:BLACK\s+LABEL|PRISTINE|GEM\s+MINT|MINT))?$/;

function opNormalise(s: string): string {
  return fold(s).replace(APOSTROPHE, "").replace(/[^A-Z0-9]+/g, " ").trim();
}

/** Trailing rarity / parallel / art tokens, stripped repeatedly. */
const OP_TAIL = new Set([
  "P", "S", "AL", "SP", "C", "UC", "R", "SR", "SEC", "L", "PAR", "ALT", "ART", "FOIL", "PARALLEL", "MANGA", "LEADER", "TR", "PROMO", "HOLO",
  "RARE", "EX", "V2", "V3", "GOLD", "SILVER", "BRONZE", "SIGNED", "SERIAL", "SER", "TEXTURED", "FULL", "STAMP", "SPE", "SPECIAL", "ALTERNATE", "ALTERNATIVE", "RED", "A", "B",
]);
/**
 * A rarity code, a "/", then a parenthesised or quoted description, a
 * truncation, or nothing: "PAR/(CHAMPIONSHIP SET 2022)", "C/(CHAMPIONSHIP",
 * "SR/", `L/"LEADER OR 1 OF..."`, `L COR/("PLAY UP TO 1...")`. The "/" that
 * JOINS two characters ("ANDROID 18/FRANKY") is followed by a name, never by
 * a bracket, a quote or the end, so it is left alone.
 */
const OP_RARITY_SLASH = /\s+[A-Z]{1,3}\s*\/\s*(?:[("“].*)?$/;
/** Art variants that ride in the name (measured), lifted to `facets.variant`. */
const OP_ART_PHRASES: [RegExp, string][] = [
  [/\s+WANTED\s+POSTER\b/, "Wanted Poster"],
  [/\s+MANGA\s+ART\b/, "Manga Art"],
  [/\s+ALT\s+ART\b/, "Alt Art"],
  [/\s+FULL\s+ART\b/, "Full Art"],
];
/** Words that make an unaliased leftover a sentence, not a name. */
const OP_MAX_WORDS = 4;

/** One part of a possibly multi-character name → its character, or a guest. */
function opResolve(part: string): { key: string | null; name: string } | null {
  const n = opNormalise(part);
  if (!n) return null;
  const hit = OP_ALIAS_INDEX.get(n);
  if (hit) return hit;
  if (OP_NOT_CHARACTERS.has(n) || GRADE_LABEL.test(n) || /^GUM GUM\b/.test(n)) return null;
  const words = n.split(" ");
  if (words.length > OP_MAX_WORDS) return null;
  // No alias, short enough to be a name: its own key, like an unaliased set.
  return { key: slugify(n), name: titleize(n) };
}

function onePieceCharacter(name: string): CharacterMatch | null {
  let s = fold(name).replace(/\s+/g, " ").trim();
  const facets: CharacterMatch["facets"] = {};

  // 1. leading year · 2. #NN anywhere · 3. DON!! prefix
  s = s.replace(/^(?:19|20)\d{2}\s+/, "");
  s = s.replace(/#\S+/g, " ");
  if (/^DON!!/.test(s)) {
    facets.variant = "DON!!";
    s = s.replace(/^DON!!\s*-?\s*/, "");
    // "DON!! CARD", "DON!! CARD (YAMATO) SUPER ALT ART": the generic DON!! card, not the character on its art.
    if (!s.trim() || /^CARD\b/.test(s)) return null;
  }
  // 4. rarity + "/" tails, balanced, truncated or empty: "PAR/(CHAMPIONSHIP SET
  //    2022)", "C/(CHAMPIONSHIP", "SR/", `L/"LEADER OR 1 OF..."` — BEFORE the
  //    quote rule, or the card text after the slash reads as an epithet.
  s = s.replace(OP_RARITY_SLASH, "");
  // 5. quoted epithets — '"SHIP DOCTOR" CHOPPER', 'EUSTASS"CAPTAIN"KID' → the variant
  s = s.replace(/["“”„]([^"“”„]*)["“”„]/g, (_, ep: string) => { const e = opNormalise(ep); if (e && !facets.variant) facets.variant = titleize(e); return " "; });
  // 6. parenthesised tails — "(GEAR 5)" is a form, anything else ("(FOIL)", "(YAMATO)") is dropped
  s = s.replace(/\(([^)]*)\)?/g, (_, inner: string) => { const m = /^\s*GEAR\s*(\d+)\s*$/.exec(inner); if (m) facets.form ??= `Gear ${m[1]}`; return " "; });
  // 7. an unparenthesised "EX GEAR 5" / "GEAR 5" tail is the same form
  s = s.replace(/\s+(?:EX\s+)?GEAR\s*(\d+)\s*$/, (_, g: string) => { facets.form ??= `Gear ${g}`; return ""; });
  // Event / slogan cards: a "!" that survived the DON!! strip is a sentence.
  if (/!/.test(s)) return null;
  // 8. art-variant phrases (measured): "WANTED POSTER SP", "MANGA ART SR", "ALT ART L B" — display-only, off the name
  for (const [re, label] of OP_ART_PHRASES) s = s.replace(re, () => { facets.variant ??= label; return " "; });

  // 9. rarity / parallel / art tails, repeatedly
  const tokens = s.replace(/[^A-Z0-9&/+'’.-]+/g, " ").trim().split(" ").filter(Boolean);
  while (tokens.length > 1 && OP_TAIL.has(tokens[tokens.length - 1].replace(/[.]/g, ""))) tokens.pop();
  s = tokens.join(" ");
  if (!s) return null;

  // 10. multi-character: "&", "/" and " AND " split the parts, in name order
  const parts = s.split(/\s*[&/]\s*|\s+AND\s+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) {
    const one = opResolve(parts[0]);
    if (!one || !one.key) return null;
    return { key: one.key, name: one.name, partners: [], partnerKeys: [], facets };
  }
  const resolved = parts.map((p) => opResolve(p) ?? { key: null, name: titleize(opNormalise(p)) });
  // The first part that is a KNOWN One Piece character is the key. When one
  // is, every unaliased co-star is a crossover guest ("ANDROID 18/FRANKY",
  // "KUMAMON & LUFFY"): it rides along in `partners` with no key of its own,
  // so no rollup is ever named after a guest. With no aliased part at all the
  // first resolvable part leads, as in the single-name case.
  const aliased = resolved.map((r) => !!r.key && OP_ALIAS_INDEX.has(opNormalise(r.name)));
  const lead = aliased.indexOf(true);
  const keyAt = lead >= 0 ? lead : resolved.findIndex((r) => !!r.key);
  if (keyAt < 0) return null;
  const head = resolved[keyAt];
  const rest = resolved.map((r, i) => ({ r, guest: lead >= 0 && !aliased[i] })).filter((_, i) => i !== keyAt);
  return { key: head.key!, name: head.name, partners: rest.map((x) => x.r.name), partnerKeys: rest.map((x) => (x.guest ? null : x.r.key)), facets };
}

// ── the entry point ──────────────────────────────────────────────────────────

/** IPs with an extractor. Everything else → null, on no character page. */
export const CHARACTER_IPS = ["pokemon", "one_piece"] as const;
export type CharacterIp = (typeof CHARACTER_IPS)[number];

export function hasCharacterExtractor(ip: string): ip is CharacterIp {
  return (CHARACTER_IPS as readonly string[]).includes(ip);
}

/**
 * The character a card name depicts, or null: trainers, energy, items, event
 * and stage cards, and every IP without an extractor. Null means "on no
 * character page", which is correct.
 */
export function characterOf(ip: string, cardName: string | null | undefined): CharacterMatch | null {
  if (!cardName) return null;
  const name = String(cardName).trim();
  if (!name) return null;
  try {
    if (ip === "pokemon") return pokemonCharacter(name);
    if (ip === "one_piece") return onePieceCharacter(name);
    return null;
  } catch {
    return null;
  }
}

/** Every rollup key a name belongs to: the key, then the resolved partners. */
export function characterKeysOf(ip: string, cardName: string | null | undefined): string[] {
  const m = characterOf(ip, cardName);
  if (!m) return [];
  return [m.key, ...m.partnerKeys.filter((k): k is string => !!k && k !== m.key)];
}

/** `/ip/<ip>/characters/<key>` — the sets pattern, not `/c/`. */
export function characterHref(ip: string, key: string): string {
  return `/ip/${ip}/characters/${key}`;
}
