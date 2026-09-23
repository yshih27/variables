/**
 * The palette's IDENTITY group — one row per card identity, not per slab.
 *
 * "charizard psa 10" should offer THE Charizard PSA 10 (one identity, fourteen
 * slabs across three venues), not fourteen token rows. The token group still
 * exists, relabelled "Slabs", for the reader who wants one specific cert.
 *
 * Built from the same cached panel + dims the identity reader uses, so a search
 * hit and the page it opens agree on what the identity is. Ranked by 30d sales,
 * then slab count. Cached 30 minutes with the panel.
 */
import { listIdentityIndex, cachedPanel, canonicalKeysOf } from "./identityDetail";
import { parseIdentityKey } from "./traits";
import { normalizeSetName } from "@/lib/card/setName";
import { identityHref, identityDisplayName } from "@/lib/card/identity";
import { canonicalGrade } from "./gradePremium";
import { formatCompactUsd } from "@/lib/format";

export type IdentitySearchRow = {
  slug: string;
  /** Display text: "Charizard EX · 151 #6 · PSA 10" */
  label: string;
  /** "14 slabs · $1.2K last" */
  sub: string;
  href: string;
  /** Lowercased haystack the matcher scores against. */
  haystack: string;
  sales30d: number;
  slabs: number;
};

/**
 * Uncached core. Reads the persisted panel and the persisted identity index —
 * NEVER a dims scan or a panel build on a request path.
 */
export async function buildIdentitySearchRows(): Promise<IdentitySearchRow[]> {
  const [idx, panel] = await Promise.all([listIdentityIndex(), cachedPanel()]);
  const d30 = Date.now() - 30 * 86_400_000;
  const sales30 = new Map<string, number>();
  const last = new Map<string, { ts: string; priceUsd: number }>();
  for (const r of panel) {
    if (!r.identity) continue;
    if (Date.parse(r.ts) >= d30) sales30.set(r.identity, (sales30.get(r.identity) ?? 0) + 1);
    const cur = last.get(r.identity);
    if (!cur || r.ts > cur.ts) last.set(r.identity, { ts: r.ts, priceUsd: r.priceUsd });
  }

  const rows: IdentitySearchRow[] = [];
  for (const [slug, allKeysOfSlug] of idx.bySlug) {
    // An alias slug (an old URL kept answering) is the same card as its own
    // URL's row — offering both would list the card twice, once at a URL it
    // no longer lives at.
    const keys = canonicalKeysOf(slug, allKeysOfSlug);
    if (!keys.length) continue;
    // The same card can be keyed twice (set-string fragments); sum across keys
    // for the search row so the card's true activity ranks it.
    const s30 = keys.reduce((a, k) => a + (sales30.get(k) ?? 0), 0);
    const nSlabs = keys.reduce((a, k) => a + (idx.slabsByKey.get(k)?.length ?? 0), 0);
    const lastSale = keys.map((k) => last.get(k)).filter(Boolean).sort((a, b) => (b!.ts > a!.ts ? 1 : -1))[0] ?? null;
    const pk = parseIdentityKey(keys[0]);
    if (!pk) continue;
    const setName = pk.parts.set ? normalizeSetName(pk.parts.set).name : null;
    const grade = canonicalGrade(pk.parts.grade);
    const name = identityDisplayName(pk.parts.cardName ?? "");
    const mid = [setName, pk.parts.number ? `#${pk.parts.number}` : null].filter(Boolean).join(" ");
    rows.push({
      slug,
      label: [name, mid || null, grade].filter(Boolean).join(" · "),
      sub: `${nSlabs} slab${nSlabs === 1 ? "" : "s"}${lastSale ? ` · ${formatCompactUsd(lastSale.priceUsd)} last` : ""}`,
      href: identityHref(slug),
      haystack: `${name} ${setName ?? ""} ${pk.parts.number ?? ""} ${grade} ${pk.ip}`.toLowerCase(),
      sales30d: s30,
      slabs: nSlabs,
    });
  }
  return rows.sort((a, b) => b.sales30d - a.sales30d || b.slabs - a.slabs);
}

/**
 * ⚠️ AN IN-PROCESS MEMO, NOT `unstable_cache`: ~55K rows are well over the 2 MB
 * item limit of Next's data cache (the panel hit the same wall — see
 * identityDetail.ts `cachedPanel`). A warm instance keeps the rows for 30
 * minutes; a cold one rebuilds them from the persisted panel and index in
 * well under a second. Never a dims scan, never a panel build.
 */
let rowsMemo: { at: number; p: Promise<IdentitySearchRow[]> } | null = null;
export async function readIdentitySearchRows(): Promise<IdentitySearchRow[]> {
  if (!rowsMemo || Date.now() - rowsMemo.at > 30 * 60_000) {
    const p = buildIdentitySearchRows();
    rowsMemo = { at: Date.now(), p };
    p.catch(() => { if (rowsMemo?.p === p) rowsMemo = null; });
  }
  return rowsMemo.p;
}
