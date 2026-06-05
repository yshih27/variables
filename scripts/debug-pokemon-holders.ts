/**
 * Debug: why does Pokemon detail page show only 2 unique holders for
 * thousands of trades?
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { collectSales } from "../src/lib/rarible/queries";
import { getBeezieMetadataCachedOnly } from "../src/lib/data/beezieTraits";
import { extractCategoryHints } from "../src/lib/data/beezieTraits";
import { classifyIP } from "../src/lib/data/ipCatalog";

const BEEZIE = "BASE:0xbb5ec6fd4b61723bd45c399840f1d868840ca16f";
const DAY = 24 * 60 * 60 * 1000;

async function main() {
  console.log("Pulling Beezie 24h sales…");
  const sales = await collectSales(BEEZIE, DAY);
  console.log(`  ${sales.length} sales total`);

  const buyers = new Set(sales.map((s) => s.buyer));
  console.log(`  ${buyers.size} unique buyers (across all categories)`);

  const tokenIds = [...new Set(sales.map((s) => s.tokenId))];
  const metas = await getBeezieMetadataCachedOnly(tokenIds);
  console.log(`  ${tokenIds.length} unique tokens · ${metas.size} cached`);

  const pokemonSales = sales.filter((s) => {
    const m = metas.get(s.tokenId);
    if (!m) return false;
    return classifyIP(extractCategoryHints(m)).key === "pokemon";
  });
  console.log(`  ${pokemonSales.length} Pokemon sales`);

  const pokeBuyers = new Set(pokemonSales.map((s) => s.buyer));
  console.log(`  ${pokeBuyers.size} unique Pokemon buyers`);

  const pokeBuyersArr = [...pokeBuyers];
  console.log(`  first 10 buyer values:`);
  for (const b of pokeBuyersArr.slice(0, 10)) console.log(`    ${JSON.stringify(b)}`);

  // Counts per buyer
  const bcount = new Map<string, number>();
  for (const s of pokemonSales) bcount.set(s.buyer, (bcount.get(s.buyer) ?? 0) + 1);
  const top = [...bcount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  top 5 buyers by sale count:`);
  for (const [b, c] of top) console.log(`    ${b}: ${c} sales`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
