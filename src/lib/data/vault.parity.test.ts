/**
 * PARITY — a vault line and the identity page cannot disagree.
 *
 * For 25 identities from the live index, `valueIdentities` (the vault's door)
 * must equal `readIdentityDetail` (the page's reader, the one behind
 * `/api/public/price/<slug>`) field for field: the whole `monthly` series, the
 * last sale, and the floor with `vsMonthly` and `coverage`.
 *
 * Needs data: runs only with SNAPSHOT_LOCAL_DIR pointing at a
 * `warm-sale-panel.ts --out=<dir>` build (plus `.env.local` for the card-row
 * reads the page makes). Skipped otherwise, so `npm run test:vault` stays
 * hermetic in CI.
 *
 *   SNAPSHOT_LOCAL_DIR=/tmp/out npx tsx --env-file=.env.local --test src/lib/data/vault.parity.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const LIVE = !!process.env.SNAPSHOT_LOCAL_DIR;

test("valueIdentities equals the identity page for 25 live identities", { skip: !LIVE && "set SNAPSHOT_LOCAL_DIR to a --out build" }, async () => {
  const { cachedPanel, valueIdentities, readIdentityDetail, listIdentityIndex, cachedListingIndex } = await import("./identityDetail");
  const { priceFieldsOf } = await import("./referencePrice");
  const { parseIdentityKey } = await import("./traits");
  const { identitySlug } = await import("@/lib/card/identity");

  const panel = await cachedPanel();
  const idx = await listIdentityIndex();
  const listings = await cachedListingIndex();
  const sold = new Map<string, number>();
  for (const r of panel) if (r.identity) sold.set(r.identity, (sold.get(r.identity) ?? 0) + 1);
  const ranked = [...sold].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  // 20 spread across the sales ranking (the busiest to a single sale) …
  const picks = new Set(Array.from({ length: 20 }, (_, i) => ranked[Math.round((i * (ranked.length - 1)) / 19)]));
  // … and 5 that carry a live ask, so the floor rule is exercised on real asks.
  for (const [k, slabs] of idx.slabsByKey) {
    if (picks.size >= 25) break;
    if (!picks.has(k) && sold.has(k) && slabs.some((s) => listings.has(`${s.platform}:${s.tokenId}`))) picks.add(k);
  }
  const keys = [...picks];
  assert.equal(keys.length, 25);

  const valued = await valueIdentities(keys);
  const rows: string[] = [];
  for (const key of keys) {
    const pk = parseIdentityKey(key)!;
    const slug = identitySlug(pk.ip, pk.parts)!;
    const detail = await readIdentityDetail(slug);
    assert.ok(detail, `no page for ${slug}`);
    const v = valued.get(key);
    assert.ok(v, `no valuation for ${key}`);
    assert.equal(v.key, detail.key, `${slug}: canonical key`);
    assert.deepEqual(v.monthly, detail.monthly, `${slug}: monthly`);
    const last = (xs: { ts: string }[]) => [...xs].sort((a, b) => b.ts.localeCompare(a.ts))[0] ?? null;
    assert.deepEqual(last(v.sales), last(detail.sales), `${slug}: last sale`);
    assert.deepEqual(v.floor, detail.floor, `${slug}: floor`);
    // And the three published fields, as the price endpoint builds them.
    const a = priceFieldsOf(v);
    const b = priceFieldsOf(detail);
    assert.deepEqual([a.price, a.lastSale, a.floor], [b.price, b.lastSale, b.floor], `${slug}: price fields`);
    rows.push(
      `${slug.padEnd(70)} sales ${String(detail.sales.length).padStart(4)} · ref ${a.price ? `$${a.price.priceUsd} (${a.price.month}, n=${a.price.n})` : "—"} · last ${a.lastSale ? `$${a.lastSale.priceUsd}` : "—"} · floor ${a.floor ? `$${a.floor.priceUsd}${a.floor.plausible ? "" : " (not plausible)"}` : "—"}`,
    );
  }
  console.log(`\nparity: ${keys.length}/${keys.length} identities equal field for field\n  ${rows.join("\n  ")}`);
});
