/**
 * Audit the DYLI Boxes table against DYLI's own API: each box's stated EV ÷
 * price from /boxes, and for the busiest boxes the 7 days of /boxes/{id}/history
 * before `asOf` (count, mean and median FMV ÷ price). Reads the API only.
 *
 *   npx tsx --env-file=.env.local scripts/dev/audit-dyli-boxes.ts <ours.json> <asOfIso> [top=3]
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { fetchAllBoxes, fetchBoxHistoryPage, type DyliPull } from "../../src/lib/dyli/boxes";

type Ours = { name: string; priceUsd: number; evStated: number | null; pulls7d: number | null; evRealized: number | null; medianReturn: number | null; realizedN: number | null };
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function main() {
  const [file, asOf, top = "3"] = process.argv.slice(2);
  const ours = JSON.parse(readFileSync(file, "utf8")) as Ours[];
  const boxes = await fetchAllBoxes();
  const byName = new Map(boxes.map((b) => [b.name, b]));
  let same = 0;
  for (const o of ours) {
    const b = byName.get(o.name);
    const api = b && b.price_usd && b.expected_value_usd != null ? b.expected_value_usd / b.price_usd : null;
    const ok = api != null && o.evStated != null && Math.abs(api - o.evStated) < 0.005 && b!.price_usd === o.priceUsd;
    if (ok) same++;
    else console.log(`  says differs: ${o.name} · ours $${o.priceUsd} ${o.evStated?.toFixed(3)}× · API $${b?.price_usd} ${api?.toFixed(3)}× (fmv_ratio ${b?.fmv_ratio})`);
  }
  console.log(`stated EV ÷ price: ${same} of ${ours.length} boxes match DYLI's /boxes (${boxes.length} boxes in the API)`);

  const toMs = Date.parse(asOf);
  const fromMs = toMs - 7 * 86_400_000;
  for (const o of [...ours].sort((a, b) => (b.pulls7d ?? 0) - (a.pulls7d ?? 0)).slice(0, Number(top))) {
    const b = byName.get(o.name);
    if (!b) continue;
    const pulls: DyliPull[] = [];
    let cursor: number | undefined;
    for (let i = 0; i < 40; i++) {
      const page = await fetchBoxHistoryPage(b.box_id, cursor);
      pulls.push(...page.pulls);
      const oldest = page.pulls.reduce((m, p) => Math.min(m, Date.parse(p.pulled_at)), Infinity);
      if (!page.hasMore || page.nextCursor == null || oldest < fromMs) break;
      cursor = page.nextCursor;
    }
    const inWin = pulls.filter((p) => Date.parse(p.pulled_at) >= fromMs && Date.parse(p.pulled_at) < toMs);
    const mults = inWin.filter((p) => (p.fmv_usd ?? 0) > 0).map((p) => p.fmv_usd! / o.priceUsd);
    const mean = mults.length ? mults.reduce((s, x) => s + x, 0) / mults.length : null;
    console.log(`${o.name}: API ${inWin.length} pulls (${mults.length} valued) · returned ${mean?.toFixed(2)}× · typical ${median(mults)?.toFixed(2)}× | ours ${o.pulls7d} pulls (n ${o.realizedN}) · ${o.evRealized?.toFixed(2)}× · ${o.medianReturn?.toFixed(2)}×`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
