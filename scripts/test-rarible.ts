/**
 * Smoke test: verify the Rarible adapter works against Courtyard.
 * Run: npx tsx scripts/test-rarible.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { computeStatsFromSales, getCollection } from "../src/lib/rarible/queries";

const COLLECTIONS = [
  { name: "Courtyard", id: "POLYGON:0x251be3a17af4892035c37ebf5890f4a4d889dcad" },
  { name: "Beezie", id: "BASE:0xbb5ec6fd4b61723bd45c399840f1d868840ca16f" },
] as const;

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  for (const { name, id } of COLLECTIONS) {
    console.log(`\n=== ${name} (${id}) ===`);
    const c = await getCollection(id);
    console.log(`meta: name=${c.name} type=${c.type} hasTraits=${c.hasTraits ?? false}`);

    const t0 = Date.now();
    const s24 = await computeStatsFromSales(id, DAY);
    console.log(
      `24h: sales=${s24.salesCount} vol=$${s24.volumeUsd.toFixed(0)} avg=$${s24.avgTradeUsd.toFixed(2)} buyers=${s24.uniqueBuyers} sellers=${s24.uniqueSellers} (${Date.now() - t0}ms)`,
    );

    const t1 = Date.now();
    const s7 = await computeStatsFromSales(id, 7 * DAY);
    console.log(
      `7d:  sales=${s7.salesCount} vol=$${s7.volumeUsd.toFixed(0)} avg=$${s7.avgTradeUsd.toFixed(2)} (${Date.now() - t1}ms)`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
