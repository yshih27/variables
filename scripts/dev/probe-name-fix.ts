/**
 * The card-name fix, before → after, from two local `--out` warms.
 *
 *   npx tsx scripts/dev/probe-name-fix.ts <before-dir> <after-dir>
 *
 * <before-dir> is `warm-sale-panel --out` run on the commit BEFORE the fix,
 * <after-dir> the same on the fix. Reads only those local files — nothing here
 * touches a database — and prints what docs/roadmap/brief-backend-card-name-
 * fallback.md §6 asks for:
 *
 *   • per IP, identities named after a grade → named, before → after, and the
 *     character mapping for the IPs with an extractor (One Piece, Pokémon),
 *     counted like for like (an alias URL is not an identity);
 *   • the identities whose key changes: over every identity the index knows
 *     (all slabs) and over the traded ones (the panel);
 *   • the old URLs: every grade-named slug of the BEFORE index must still
 *     resolve in the AFTER index, to identities with real names, and never be
 *     their canonical URL (so the API answers `canonical: false`) — unless
 *     none of its slabs has a name any more, in which case there is no
 *     identity for it to answer with and it is listed as unrecovered.
 *
 * Exits 1 if an old grade-named URL stops answering although its slabs were
 * given a real name — the alias registration failing, not the name fallback.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { parseIdentityKey } from "../../src/lib/data/traits";
import { startsWithGradeLabel } from "../../src/lib/card/grade";
import { identitySlug, supersededIdentitySlug } from "../../src/lib/card/identity";
import { characterOf, CHARACTER_IPS } from "../../src/lib/card/character";

type IndexSnap = { keys: string[]; bySlug: Record<string, number[]> };
type SlabsSnap = { slabs: Record<string, string[]> };
type PanelSnap = { rows: { identity: string | null; ip: string; platform: string; tokenId: string }[] };
type Coverage = Record<string, { identities: number; mapped: number; multiCharacter: number }>;
type RollupSnap = { characters: Record<string, unknown>; coverage: Coverage };

function inflate<T>(dir: string, key: string): T {
  const raw = JSON.parse(readFileSync(join(dir, `${key}.json`), "utf8")) as { __gz__: string };
  return JSON.parse(gunzipSync(Buffer.from(raw.__gz__, "base64")).toString()) as T;
}

const nameOf = (k: string) => parseIdentityKey(k)?.parts.cardName ?? "";
const ipOf = (k: string) => k.slice(0, k.indexOf("|"));

function main() {
  const [beforeDir, afterDir] = process.argv.slice(2);
  if (!beforeDir || !afterDir) throw new Error("usage: probe-name-fix.ts <before-dir> <after-dir>");
  const load = (dir: string) => ({
    index: inflate<IndexSnap>(dir, "identity-index"),
    slabs: inflate<SlabsSnap>(dir, "identity-slabs"),
    panel: inflate<PanelSnap>(dir, "sale-panel"),
    rollups: inflate<RollupSnap>(dir, "character-rollups"),
  });
  const b = load(beforeDir);
  const a = load(afterDir);

  // ── per IP: grade-named vs named identities, every identity the index knows ──
  const perIp = (idx: IndexSnap) => {
    const m = new Map<string, { identities: number; graded: number }>();
    for (const k of idx.keys) {
      const ip = ipOf(k);
      const cur = m.get(ip) ?? { identities: 0, graded: 0 };
      cur.identities += 1;
      if (startsWithGradeLabel(nameOf(k))) cur.graded += 1;
      m.set(ip, cur);
    }
    return m;
  };
  const ipB = perIp(b.index);
  const ipA = perIp(a.index);
  const ips = [...new Set([...ipB.keys(), ...ipA.keys()])].sort((x, y) => (ipB.get(y)?.graded ?? 0) - (ipB.get(x)?.graded ?? 0) || x.localeCompare(y));
  console.log(`\nIDENTITIES NAMED AFTER A GRADE, per IP (every identity the index knows: slabs, traded or not)`);
  console.log(`  ${"IP".padEnd(16)} ${"identities before → after".padEnd(28)} grade-named before → after`);
  let gB = 0, gA = 0;
  for (const ip of ips) {
    const x = ipB.get(ip) ?? { identities: 0, graded: 0 };
    const y = ipA.get(ip) ?? { identities: 0, graded: 0 };
    gB += x.graded;
    gA += y.graded;
    if (!x.graded && !y.graded) continue;
    console.log(`  ${ip.padEnd(16)} ${`${x.identities.toLocaleString()} → ${y.identities.toLocaleString()}`.padEnd(28)} ${x.graded} → ${y.graded}`);
  }
  console.log(`  ${"ALL".padEnd(16)} ${`${b.index.keys.length.toLocaleString()} → ${a.index.keys.length.toLocaleString()}`.padEnd(28)} ${gB} → ${gA}`);

  // ── character mapping, like for like ──
  // An identity is a CANONICAL slug: the URL some key's own parts produce. The
  // v4.1 aliases and the name-fix aliases are other URLs for identities
  // already counted, so both sides are counted by the same rule. (The BEFORE
  // index holds grade-named keys, whose URL only the unguarded builder can
  // still produce — this probe and the slug index are its only readers.)
  const canonical = (idx: IndexSnap) => {
    const out = new Map<string, string>(); // canonical slug → a key it belongs to
    for (const [slug, ix] of Object.entries(idx.bySlug)) {
      for (const i of ix) {
        const k = idx.keys[i];
        const pk = parseIdentityKey(k);
        if (pk && supersededIdentitySlug(pk.ip, pk.parts) === slug) { out.set(slug, k); break; }
      }
    }
    return out;
  };
  const cB = canonical(b.index);
  const cA = canonical(a.index);
  const mapping = (c: Map<string, string>, ip: string) => {
    let identities = 0, mapped = 0;
    for (const k of c.values()) {
      if (ipOf(k) !== ip) continue;
      identities++;
      if (characterOf(ip, nameOf(k))) mapped++;
    }
    return { identities, mapped };
  };
  const pct = (c: { identities: number; mapped: number }) => (c.identities ? `${((c.mapped / c.identities) * 100).toFixed(1)}%` : "—");
  console.log(`\nCHARACTER MAPPING, like for like (identities = canonical URLs; aliases are not identities)`);
  for (const ip of CHARACTER_IPS) {
    const x = mapping(cB, ip);
    const y = mapping(cA, ip);
    console.log(`  ${ip.padEnd(10)} ${x.mapped.toLocaleString()} / ${x.identities.toLocaleString()} (${pct(x)}) → ${y.mapped.toLocaleString()} / ${y.identities.toLocaleString()} (${pct(y)})`);
  }
  console.log(`  slug index: ${Object.keys(b.index.bySlug).length.toLocaleString()} entries (${cB.size.toLocaleString()} canonical) → ${Object.keys(a.index.bySlug).length.toLocaleString()} (${cA.size.toLocaleString()} canonical)`);
  console.log(`\n  as the warmers' own character-rollups report it (BEFORE counted every slug, aliases included):`);
  for (const ip of Object.keys({ ...b.rollups.coverage, ...a.rollups.coverage })) {
    const x = b.rollups.coverage[ip];
    const y = a.rollups.coverage[ip];
    const p2 = (c?: { identities: number; mapped: number }) => (c ? `${c.mapped.toLocaleString()} / ${c.identities.toLocaleString()} (${pct(c)})` : "—");
    console.log(`  ${ip.padEnd(10)} ${p2(x)} → ${p2(y)} · multi-character ${x?.multiCharacter ?? "—"} → ${y?.multiCharacter ?? "—"}`);
  }
  console.log(`  characters ${Object.keys(b.rollups.characters).length.toLocaleString()} → ${Object.keys(a.rollups.characters).length.toLocaleString()}`);
  console.log(`  (sports, Yu-Gi-Oh and the rest have no character extractor yet: their gain is the names above, which a players lexicon will read)`);

  // ── keys that change ──
  const keysB = new Set(b.index.keys);
  const keysA = new Set(a.index.keys);
  const onlyB = [...keysB].filter((k) => !keysA.has(k));
  const onlyA = [...keysA].filter((k) => !keysB.has(k));
  const onlyBGraded = onlyB.filter((k) => startsWithGradeLabel(nameOf(k)));
  console.log(`\nIDENTITY KEYS, every identity the index knows`);
  console.log(`  ${keysB.size.toLocaleString()} → ${keysA.size.toLocaleString()} · ${onlyB.length.toLocaleString()} keys disappear (${onlyBGraded.length} of them grade-named) · ${onlyA.length.toLocaleString()} keys appear`);
  const otherGone = onlyB.filter((k) => !startsWithGradeLabel(nameOf(k)));
  if (otherGone.length) console.log(`  keys that disappear WITHOUT a grade-label name (${otherGone.length}):\n${otherGone.slice(0, 20).map((k) => `    ${k}`).join("\n")}`);

  const panelKeys = (p: PanelSnap) => new Set(p.rows.map((r) => r.identity).filter((k): k is string => !!k));
  const pB = panelKeys(b.panel);
  const pA = panelKeys(a.panel);
  const pOnlyB = [...pB].filter((k) => !pA.has(k));
  const pOnlyA = [...pA].filter((k) => !pB.has(k));
  // Row-level, joined on the token (the two warms minutes apart can differ by a few new sales).
  const tokKey = new Map(b.panel.rows.map((r) => [`${r.platform}:${r.tokenId}`, r.identity]));
  let rowsMoved = 0, rowsGained = 0, rowsLost = 0, rowsSame = 0, rowsNew = 0;
  for (const r of a.panel.rows) {
    const t = `${r.platform}:${r.tokenId}`;
    if (!tokKey.has(t)) { rowsNew++; continue; }
    const was = tokKey.get(t) ?? null;
    if (was === r.identity) rowsSame++;
    else if (was && r.identity) rowsMoved++;
    else if (r.identity) rowsGained++;
    else rowsLost++;
  }
  console.log(`\nTRADED IDENTITIES (the sale panel: ${b.panel.rows.length.toLocaleString()} → ${a.panel.rows.length.toLocaleString()} sales)`);
  console.log(`  ${pB.size.toLocaleString()} → ${pA.size.toLocaleString()} · ${pOnlyB.length} keys disappear (${pOnlyB.filter((k) => startsWithGradeLabel(nameOf(k))).length} grade-named) · ${pOnlyA.length} appear`);
  console.log(`  sales re-keyed ${rowsMoved} · gained an identity ${rowsGained} · lost one ${rowsLost} · unchanged ${rowsSame.toLocaleString()} · sales new since the before-warm ${rowsNew}`);

  // ── the old URLs ──
  const slugsA = new Map(Object.entries(a.index.bySlug).map(([s, ix]) => [s, ix.map((i) => a.index.keys[i])]));
  const gradedSlugsB = Object.entries(b.index.bySlug)
    .filter(([, ix]) => ix.some((i) => startsWithGradeLabel(nameOf(b.index.keys[i]))))
    .map(([s]) => s);
  // card id → its key in the AFTER index: does a dead URL's card still have an identity?
  const keyOfCardA = new Map<string, string>();
  for (const [i, ids] of Object.entries(a.slabs.slabs)) for (const id of ids) keyOfCardA.set(id, a.index.keys[Number(i)]);
  const cardsOfKeyB = new Map<string, string[]>();
  for (const [i, ids] of Object.entries(b.slabs.slabs)) cardsOfKeyB.set(b.index.keys[Number(i)], ids);
  let answer = 0, dead = 0, unrecovered = 0, named = 0, split = 0, notCanonical = 0;
  const deadList: string[] = [];
  const unrecoveredList: string[] = [];
  for (const s of gradedSlugsB) {
    const keys = slugsA.get(s);
    if (!keys?.length) {
      const renamed = b.index.bySlug[s].some((i) => (cardsOfKeyB.get(b.index.keys[i]) ?? []).some((id) => keyOfCardA.has(id)));
      if (renamed) { dead++; if (deadList.length < 20) deadList.push(s); }
      else { unrecovered++; if (unrecoveredList.length < 30) unrecoveredList.push(s); }
      continue;
    }
    answer++;
    if (keys.every((k) => !startsWithGradeLabel(nameOf(k)))) named++;
    if (keys.length > 1) split++;
    const pk = parseIdentityKey(keys[0]);
    const canonical = pk ? identitySlug(pk.ip, pk.parts) : null;
    if (canonical && canonical !== s) notCanonical++;
  }
  console.log(`\nOLD URLS (every slug of the BEFORE index that named a grade)`);
  console.log(
    `  ${gradedSlugsB.length} old URLs · ${answer} still answer · ${named} resolve only to real names · ${split} resolve to more than one card (titles naming a base and its parallel, or one card two ways) · ` +
      `${notCanonical} are not their card's canonical URL (→ canonical: false) · ${unrecovered} unrecovered (no slab has a name any more: nothing to answer with) · ${dead} DEAD although renamed`,
  );
  if (unrecoveredList.length) console.log(`  unrecovered:\n${unrecoveredList.map((s) => `    ${s}`).join("\n")}`);
  if (deadList.length) console.log(`  ✗ DEAD although renamed:\n${deadList.map((s) => `    ${s}`).join("\n")}`);
  const examples = gradedSlugsB.slice(0, 6).map((s) => `    /i/${s}  →  ${(slugsA.get(s) ?? []).map((k) => { const pk = parseIdentityKey(k); return pk ? `/i/${identitySlug(pk.ip, pk.parts)}` : k; }).join(" + ")}`);
  console.log(`  e.g.\n${examples.join("\n")}`);
  if (dead) process.exitCode = 1;
}

main();
