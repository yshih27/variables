/**
 * Generate src/lib/card/pokemonSpecies.ts — the Pokémon species lexicon the
 * character extractor (src/lib/card/character.ts) matches card names against.
 *
 *   npx tsx scripts/dev/gen-pokemon-species.ts
 *
 * Source: PokéAPI's data repository (github.com/PokeAPI/pokeapi), the two CSVs
 * `data/v2/csv/pokemon_species.csv` (id, identifier, generation) and
 * `data/v2/csv/pokemon_species_names.csv` (English display name, language 9).
 * No API key, no rate limit — two raw-file reads. The generated file records
 * the fetch date and the species count in its header, so a regeneration that
 * adds a generation is a visible diff, not a silent one.
 *
 * `key` is PokéAPI's identifier verbatim ("mr-mime", "farfetchd", "nidoran-f",
 * "ho-oh", "type-null", "tapu-koko", "porygon-z", "flabebe", "sirfetchd",
 * "jangmo-o", "mime-jr", "porygon2"): already the lowercase ASCII slug the
 * rollup needs, so the extractor never has to derive one. `name` is the
 * English display form ("Mr. Mime", "Farfetch’d", "Nidoran♀", "Flabébé").
 *
 * Pure data file; nothing here is production, nothing here writes to it.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const RAW = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
const ENGLISH = 9;

/** Minimal CSV parser — the two files quote nothing exotic, but names carry ♀/♂/’/é. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const cells: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { cells.push(cur); cur = ""; }
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

async function csv(name: string): Promise<string[][]> {
  const res = await fetch(`${RAW}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return parseCsv(await res.text());
}

async function main() {
  const [species, names] = await Promise.all([csv("pokemon_species.csv"), csv("pokemon_species_names.csv")]);
  const sh = species[0], nh = names[0];
  const col = (h: string[], k: string) => { const i = h.indexOf(k); if (i < 0) throw new Error(`column ${k} missing`); return i; };
  const sId = col(sh, "id"), sIdent = col(sh, "identifier"), sGen = col(sh, "generation_id");
  const nId = col(nh, "pokemon_species_id"), nLang = col(nh, "local_language_id"), nName = col(nh, "name");

  const english = new Map<number, string>();
  for (const r of names.slice(1)) if (Number(r[nLang]) === ENGLISH) english.set(Number(r[nId]), r[nName]);

  const rows = species
    .slice(1)
    .map((r) => ({ id: Number(r[sId]), key: r[sIdent], name: english.get(Number(r[sId])) ?? "", gen: Number(r[sGen]) }))
    .filter((r) => Number.isFinite(r.id) && r.key && r.name)
    .sort((a, b) => a.id - b.id);
  if (rows.length < 1000) throw new Error(`only ${rows.length} species parsed — refusing to write a truncated lexicon`);
  const date = new Date().toISOString().slice(0, 10);
  const last = rows[rows.length - 1];

  const out = `/**
 * POKÉMON SPECIES LEXICON — GENERATED, DO NOT EDIT BY HAND.
 *
 * Source: PokéAPI data (github.com/PokeAPI/pokeapi, data/v2/csv/pokemon_species.csv
 * + pokemon_species_names.csv, English names), fetched ${date} by
 * scripts/dev/gen-pokemon-species.ts. ${rows.length.toLocaleString("en-US")} species, National Dex
 * #1 ${rows[0].name} → #${last.id} ${last.name} (Gen ${last.gen}).
 *
 * \`key\` is PokéAPI's identifier verbatim — already the lowercase ASCII slug the
 * character rollup is named by ("mr-mime", "farfetchd", "nidoran-f", "ho-oh",
 * "type-null", "tapu-koko", "porygon-z", "flabebe"). \`name\` is the English
 * display form. Regional / Mega / Dark / Shining forms are NOT species: the
 * extractor reads them as facets in front of the species (src/lib/card/character.ts).
 *
 * Read by character.ts only. Regenerate with the script above when a generation
 * lands; the header's count and date make that a visible diff.
 */
export type PokemonSpecies = { id: number; key: string; name: string; gen: number };

export const POKEMON_SPECIES: readonly PokemonSpecies[] = [
${rows.map((r) => `  { id: ${r.id}, key: ${JSON.stringify(r.key)}, name: ${JSON.stringify(r.name)}, gen: ${r.gen} },`).join("\n")}
];
`;
  const file = join(process.cwd(), "src/lib/card/pokemonSpecies.ts");
  writeFileSync(file, out);
  console.log(`wrote ${file}: ${rows.length} species (#1 ${rows[0].name} → #${last.id} ${last.name}, Gen ${last.gen}), source fetched ${date}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
