/**
 * Character rollups — the PR-body report and the two-path agreement check.
 *
 *   SNAPSHOT_LOCAL_DIR=/tmp/blob npx tsx --env-file=.env.local scripts/dev/probe-character-rollups.ts
 *
 * Reads the snapshots `warm-sale-panel --out=/tmp/blob` wrote (sale-panel,
 * identity-index, identity-slabs, character-rollups) — through readSnapshot,
 * so with SNAPSHOT_LOCAL_DIR set nothing here touches production — and prints
 * what docs/roadmap/brief-backend-character-rollups.md §8 asks for:
 *
 *   • per IP, the share of identities that map to a character
 *   • the top 30 unmapped Pokémon names by 30d sales (misses visible)
 *   • the top 30 characters by 30d volume — identities, slabs, share of IP,
 *     index published or gated (priced vs the floor)
 *   • the One Piece alias table in full, and the multi-character count
 *   • three sample identity names for each of the top 50 characters
 *   • snapshot size (gz), the largest single character's payload
 *   • reader timings cold / warm for pokemon/charizard, pokemon/pikachu and
 *     one thin character
 *   • the two-path check: for 1,000 random identities, `characterOf` on the
 *     identity page's own parts (the hand-up) names the same characters the
 *     snapshot's membership (`top`) files the identity under.
 *
 * Read-only. Never writes a snapshot, never records freshness.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readSnapshot } from "../../src/lib/db/snapshots";
import { readCharacterDetail, readCharacterRollupsSnapshot, CHARACTER_ROLLUPS_SNAPSHOT_KEY, type CharacterRollupsSnapshot } from "../../src/lib/data/characterRollups";
import { listIdentityIndex } from "../../src/lib/data/identityDetail";
import { parseIdentityKey } from "../../src/lib/data/traits";
import { characterKeysOf, ONE_PIECE_ALIASES } from "../../src/lib/card/character";
import { MIN_IDENTITIES_BROAD } from "../../src/lib/data/identityIndex";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

/** Deterministic LCG so the 1,000-identity sample is reproducible. */
function lcg(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

async function main() {
  console.log(`\nCHARACTER ROLLUPS — probe (${process.env.SNAPSHOT_LOCAL_DIR ? `LOCAL ${process.env.SNAPSHOT_LOCAL_DIR}` : "PRODUCTION READ"})\n`);

  // ── size ──
  const raw = await readSnapshot<{ __gz__: string }>(CHARACTER_ROLLUPS_SNAPSHOT_KEY);
  if (!raw?.__gz__) throw new Error("no character-rollups snapshot — run warm-sale-panel --out first");
  const gzBytes = Buffer.from(raw.__gz__, "base64").length;
  console.log(`snapshot: ${(gzBytes / 1024 / 1024).toFixed(2)} MB gz (${(raw.__gz__.length / 1024 / 1024).toFixed(2)} MB base64 as stored)`);

  const snap = (await readCharacterRollupsSnapshot()) as CharacterRollupsSnapshot;
  console.log(`generatedAt ${snap.generatedAt} · panelRows ${snap.panelRows.toLocaleString()} · characters ${Object.keys(snap.characters).length.toLocaleString()}`);
  let largest = { id: "", bytes: 0 };
  let jsonTotal = 0;
  for (const [id, c] of Object.entries(snap.characters)) {
    const b = Buffer.byteLength(JSON.stringify(c));
    jsonTotal += b;
    if (b > largest.bytes) largest = { id, bytes: b };
  }
  console.log(`inflated JSON ${(jsonTotal / 1024 / 1024).toFixed(2)} MB · largest character ${largest.id} = ${(largest.bytes / 1024).toFixed(0)} KB (unstable_cache item limit 2 MB)\n`);

  // ── coverage ──
  console.log("MAPPED SHARE PER IP");
  for (const [ip, c] of Object.entries(snap.coverage)) {
    console.log(`  ${ip.padEnd(10)} ${c.mapped.toLocaleString().padStart(7)} / ${c.identities.toLocaleString().padStart(7)} identities map to a character (${pct(c.identities ? (c.mapped / c.identities) * 100 : 0)}) · ${c.multiCharacter.toLocaleString()} multi-character`);
  }

  // ── unmapped ──
  for (const ip of Object.keys(snap.coverage)) {
    console.log(`\nTOP 30 UNMAPPED ${ip.toUpperCase()} NAMES BY 30D SALES`);
    for (const u of snap.coverage[ip].unmappedTop.slice(0, 30)) {
      console.log(`  ${String(u.sales30d).padStart(4)} sales30d · ${String(u.identities).padStart(4)} ids · ${u.name}`);
    }
  }

  // ── top 30 characters ──
  const all = Object.values(snap.characters).sort((a, b) => b.kpis.volume30d - a.kpis.volume30d);
  console.log("\nTOP 30 CHARACTERS BY 30D VOLUME");
  console.log("  " + ["character", "ip", "ids", "slabs", "sales30d", "vol30d", "shareOfIp", "index", "priced/needed", "latest"].map((h, i) => h.padEnd([28, 10, 6, 6, 8, 10, 9, 10, 13, 10][i])).join(" "));
  for (const c of all.slice(0, 30)) {
    const last = c.index?.at(-1);
    console.log(
      "  " +
        [
          c.name.slice(0, 27),
          c.ip,
          String(c.identities),
          String(c.slabs),
          String(c.kpis.sales30d),
          money(c.kpis.volume30d),
          pct(c.kpis.shareOfIp30d),
          c.index ? `published${c.index.some((p) => p.thin) ? "·thin" : ""}` : `gated(${c.indexGate.held})`,
          `${c.indexGate.priced}/${c.indexGate.needed}`,
          last ? `${last.ts.slice(0, 7)} ${last.value.toFixed(1)}` : "—",
        ]
          .map((v, i) => v.padEnd([28, 10, 6, 6, 8, 10, 9, 10, 13, 10][i]))
          .join(" "),
    );
  }
  const indexed = all.filter((c) => c.index);
  console.log(`\n  ${indexed.length} characters publish an index (floor ${MIN_IDENTITIES_BROAD} priced identities in the latest complete month): ${indexed.map((c) => `${c.ip}/${c.key}`).join(", ") || "none"}`);

  // ── sample names for the top 50 ──
  console.log("\nTHREE SAMPLE NAMES PER CHARACTER (top 50) — false-positive eyeball");
  for (const c of all.slice(0, 50)) {
    const names = [...new Set(c.top.map((t) => t.name))];
    const pick = [names[0], names[Math.floor(names.length / 2)], names[names.length - 1]].filter((x, i, a) => x && a.indexOf(x) === i);
    console.log(`  ${(c.ip + "/" + c.key).padEnd(34)} ${String(c.identities).padStart(5)} ids · ${pick.map((n) => JSON.stringify(n)).join(" · ")}`);
  }

  // ── One Piece alias table ──
  console.log(`\nONE PIECE ALIAS TABLE (${ONE_PIECE_ALIASES.length} characters)`);
  for (const [key, name, ...aliases] of ONE_PIECE_ALIASES) console.log(`  ${key.padEnd(24)} ${name.padEnd(24)} ← ${aliases.join(" · ")}`);
  const opBoard = snap.byIp["one_piece"] ?? [];
  console.log(`\nONE PIECE CHARACTERS IN THE DATA (${opBoard.length}) — unaliased names keep their own key; check these for events/stages:`);
  const aliasKeys = new Set(ONE_PIECE_ALIASES.map(([k]) => k));
  for (const r of opBoard) console.log(`  ${aliasKeys.has(r.key) ? " " : "?"} ${r.key.padEnd(28)} ${String(r.identities).padStart(4)} ids · ${String(r.sales30d).padStart(3)} sales30d · ${money(r.volume30d)}`);

  // ── reader timings ──
  console.log("\nREADER TIMINGS (readCharacterDetail; cold = first read in this process, warm = memo)");
  const thin = all.filter((c) => c.ip === "pokemon" && !c.index && c.identities >= 5).sort((a, b) => a.kpis.volume30d - b.kpis.volume30d)[0];
  const targets: [string, string][] = [["pokemon", "charizard"], ["pokemon", "pikachu"], ...(thin ? [["pokemon", thin.key] as [string, string]] : [])];
  // A fresh memo for the cold number: this process already inflated the
  // snapshot above, so cold is measured through a child process.
  const { execFileSync } = await import("node:child_process");
  for (const [ip, key] of targets) {
    const cold = execFileSync("npx", ["tsx", "scripts/dev/probe-character-cold.ts", ip, key], { env: process.env, encoding: "utf8" }).trim().split("\n").pop() ?? "";
    const t1 = performance.now();
    const d = await readCharacterDetail(ip, key);
    const warm = performance.now() - t1;
    const [coldMs, ids] = cold.split(" ");
    console.log(`  ${(ip + "/" + key).padEnd(30)} cold ${String(coldMs).padStart(7)} ms · warm ${warm.toFixed(2).padStart(6)} ms · ${ids} identities · ${d ? `${d.top.length} rows, index ${d.index ? "published" : "gated(" + d.indexGate.held + ")"}` : "NULL"}`);
  }

  // ── two-path check ──
  console.log("\nTWO-PATH CHECK — characterOf on the identity's own parts vs the snapshot's membership, 1,000 random identities");
  const idx = await listIdentityIndex();
  const membership = new Map<string, Set<string>>();
  for (const c of Object.values(snap.characters)) for (const t of c.top) (membership.get(t.slug) ?? membership.set(t.slug, new Set()).get(t.slug)!).add(`${c.ip}:${c.key}`);
  // Identity slugs carry the slugified IP ("one-piece"); the key carries the raw one ("one_piece").
  const slugs = [...idx.bySlug.keys()].filter((s) => /^(pokemon|one-piece)\//.test(s));
  const rnd = lcg(20260917);
  let agree = 0, disagree = 0, unmappedBoth = 0;
  const examples: string[] = [];
  for (let i = 0; i < 1000 && slugs.length; i++) {
    const slug = slugs[Math.floor(rnd() * slugs.length)];
    const keys = idx.bySlug.get(slug)!;
    const pk = parseIdentityKey(keys[0]);
    if (!pk) continue;
    const page = new Set(characterKeysOf(pk.ip, pk.parts.cardName).map((k) => `${pk.ip}:${k}`));
    const snapKeys = membership.get(slug) ?? new Set<string>();
    const same = page.size === snapKeys.size && [...page].every((k) => snapKeys.has(k));
    if (same) { agree++; if (!page.size) unmappedBoth++; }
    else { disagree++; if (examples.length < 10) examples.push(`${slug} · page ${[...page].join(",") || "∅"} · snapshot ${[...snapKeys].join(",") || "∅"}`); }
  }
  console.log(`  agree ${agree} (of which unmapped on both paths ${unmappedBoth}) · disagree ${disagree}`);
  for (const e of examples) console.log(`    ✗ ${e}`);
  if (disagree) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
