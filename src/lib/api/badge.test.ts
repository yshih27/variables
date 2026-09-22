/**
 * The badge's fallback ladder and its geometry — the embed is the surface with
 * the least context around it, so what it is allowed to claim is a test, not a
 * convention.
 *
 *   npm run test:price
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeCopy, badgeUsd, renderPriceBadge, BADGE_SIZES } from "./badge";
import { decodeStepObs } from "@/lib/data/indexReceipts";
import { formatCompactUsd } from "@/lib/format";

const card = { name: "Charizard Ex", grade: "PSA 10" };

test("with a monthly price the badge prints the price, the month and the count", () => {
  const c = badgeCopy({ price: { month: "2026-08", priceUsd: 323, n: 5 }, lastSale: { ts: "2026-09-09T00:00:00Z", priceUsd: 255 }, slabs: 14 });
  assert.equal(c.kind, "price");
  assert.equal(`${c.value} · ${c.meta}`, "$323 · Aug · 5 sales");
  assert.equal(c.prefix, "");
});

test("with no monthly price it downgrades to the last SALE, and says so", () => {
  const c = badgeCopy({ price: null, lastSale: { ts: "2026-09-09T12:00:00Z", priceUsd: 255 }, slabs: 14 });
  assert.equal(c.kind, "last-sale");
  assert.equal(`${c.prefix} ${c.value} · ${c.meta}`, "last sale $255 · Sep 9");
});

test("with no sale at all it counts slabs and claims no price", () => {
  const c = badgeCopy({ price: null, lastSale: null, slabs: 14 });
  assert.equal(c.kind, "none");
  assert.equal(`${c.value} · ${c.meta}`, "no sale yet · 14 slabs");
  assert.equal(c.meta, "14 slabs");
  assert.equal(badgeCopy({ price: null, lastSale: null, slabs: 1 }).meta, "1 slab");
});

test("a floor is never a badge price", () => {
  // There is no path from a listing into badgeCopy: the ladder is price → last
  // sale → slab count, and this test is the guard on that.
  const c = badgeCopy({ price: null, lastSale: null, slabs: 0 });
  assert.equal(c.value, "no sale yet");
  assert.ok(!/\$/.test(c.value));
});

test("badgeUsd keeps cents under $100 and is the site's compact rule above it", () => {
  assert.equal(badgeUsd(1.84), "$1.84");
  assert.equal(badgeUsd(99.5), "$99.50");
  assert.equal(badgeUsd(323), formatCompactUsd(323));
  assert.equal(badgeUsd(323), "$323");
  assert.equal(badgeUsd(12_450), formatCompactUsd(12_450));
  assert.equal(badgeUsd(1_240_000), formatCompactUsd(1_240_000));
  assert.equal(badgeUsd(0), "$0");
});

test("both sizes render valid, self-contained, deterministic SVG", () => {
  for (const size of BADGE_SIZES) {
    const svg = renderPriceBadge({ ...card, price: { month: "2026-08", priceUsd: 12450, n: 23 }, lastSale: null, slabs: 3 }, size);
    assert.ok(svg.startsWith("<svg "), size);
    assert.ok(svg.includes("VARIBLE") && svg.includes("#bfef01"), `brand pair: ${size}`);
    // Nothing the badge draws may be fetched: an `<img>`-loaded SVG gets no
    // network, so an external font or image would simply not render. (The one
    // http:// in the file is the SVG namespace, which is not a fetch.)
    assert.ok(!/(?:href|src)\s*=\s*"https?:/.test(svg), `no external reference: ${size}`);
    assert.ok(!/@font-face|fonts\.googleapis|<image\b/.test(svg), `no webfont or image: ${size}`);
    assert.equal(svg.match(/https?:\/\//g)?.length, 1, `only the xmlns: ${size}`);
    assert.equal(svg, renderPriceBadge({ ...card, price: { month: "2026-08", priceUsd: 12450, n: 23 }, lastSale: null, slabs: 3 }, size), `deterministic: ${size}`);
    // The box is wide enough for its own text at the declared font sizes.
    const width = Number(/width="(\d+)"/.exec(svg)![1]);
    assert.ok(width > 100 && width < 400, `${size} width ${width}`);
  }
});

test("the badge escapes card names rather than emitting markup", () => {
  const svg = renderPriceBadge({ name: 'Pikachu <script>"&', grade: "PSA 9", price: null, lastSale: null, slabs: 2 }, "md");
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("&lt;script&gt;"));
});

test("decodeStepObs reads both the v4.1 pairs and the v4.2 receipts", () => {
  const v41 = decodeStepObs([[0.1, 3] as [number, number]]);
  assert.equal(v41.length, 1);
  assert.equal(v41[0].logReturn, 0.1);
  assert.equal(v41[0].slug, "");
  const v42 = decodeStepObs([["pokemon/151/6/charizard-ex/psa-10", 0.0998, 3, 2400, 2650, 3, 4]]);
  assert.deepEqual(v42[0], { slug: "pokemon/151/6/charizard-ex/psa-10", logReturn: 0.0998, weight: 3, priceFrom: 2400, priceTo: 2650, nFrom: 3, nTo: 4 });
  assert.deepEqual(decodeStepObs(undefined), []);
});
