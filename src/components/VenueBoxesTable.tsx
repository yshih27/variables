import type { VenueBoxes } from "@/lib/data/venueBoxes";
import type { GachaPack } from "@/lib/data/gachaPacksCache";
import { THIN_N } from "@/lib/data/gachaPackView";
import { formatCompactUsd, formatMonthDayUtc } from "@/lib/format";
import { Section } from "./Section";

/**
 * A venue's boxes (readVenueBoxes): for every box, its price, how often it was
 * pulled in 7 days, what the venue says it is worth, what the pulls returned,
 * and the biggest prize it lists. The same catalog /gacha draws, so the two
 * pages agree.
 *
 * ⚠️ NEUTRAL INK, AND EVERY RATIO SAYS WHOSE VALUE IT IS. "Says" is the venue's
 * own expected value; "returned" and "typical" are measured from pulls but
 * priced in the venue's own marks (realizedValueBasis), never a market price.
 * Under THIN_N pulls a measured ratio is not shown, and a typical pull that
 * failed the plausibility gate (gachaPackView) arrives already nulled.
 *
 * Audited Oct 14 2026 against DYLI's API: pull counts exact; returns within
 * 0.03× of DYLI's live marks, because we keep each prize's mark from when it
 * was pulled and DYLI re-marks later. Sold-out boxes are not in the catalog.
 */
const ratio = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}×`);
const measured = (p: GachaPack, v: number | null | undefined) => (p.realizedN != null && p.realizedN >= THIN_N ? ratio(v) : "—");
/** The game, as /gacha files it: a box with no game tab is "Other", never "Mixed" unless its prizes span games. */
const game = (p: GachaPack) => (p.category ? p.categoryLabel : p.mixedPool ? "Mixed" : "Other");

export function VenueBoxesTable({ venueName, boxes }: { venueName: string; boxes: VenueBoxes | null | undefined }) {
  if (!boxes?.packs.length) return null;
  const { packs } = boxes;
  const basis = packs.find((p) => p.realizedValueBasis)?.realizedValueBasis ?? `${venueName}'s value marks`;
  const asOf = formatMonthDayUtc(boxes.generatedAt);
  const pulled = packs.filter((p) => (p.pulls7d ?? 0) > 0).length;

  return (
    <Section
      id="boxes"
      className="scroll-mt-24 font-sans"
      title="Boxes"
      readMe={`every ${venueName} box: what ${venueName} says it is worth, and what pulls returned`}
      subtitle={`${packs.length} boxes on sale · ${pulled} pulled in the last 7 days · busiest first`}
      flush
    >
      <div className="scroll-x">
        <table className="w-full min-w-[820px] border-collapse text-[13px]" data-boxes>
          <thead>
            <tr className="border-b border-line">
              <Th>Box</Th>
              <Th align="right">Price</Th>
              <Th align="right">Pulls · 7d</Th>
              <Th align="right">{`${venueName} says`}</Th>
              <Th align="right">Returned</Th>
              <Th align="right">Typical pull</Th>
              <Th align="right">Top prize</Th>
            </tr>
          </thead>
          <tbody>
            {packs.map((p) => (
              <tr key={p.id} className="[&:last-child>td]:border-b-0">
                <Td>
                  <span className="font-semibold text-ink">{p.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-ink-3">{game(p)}</span>
                </Td>
                <Td align="right" className="font-mono tabular text-ink-2">
                  {formatCompactUsd(p.priceUsd)}
                </Td>
                <Td align="right" className="font-mono tabular text-ink">
                  {p.pulls7d == null ? "—" : p.pulls7d.toLocaleString("en-US")}
                </Td>
                <Td align="right" className="font-mono tabular text-ink-2">
                  {ratio(p.evStated)}
                </Td>
                <Td align="right" className="font-mono tabular font-semibold text-ink">
                  {measured(p, p.evRealized)}
                </Td>
                <Td align="right" className="font-mono tabular text-ink-2">
                  {measured(p, p.medianReturn)}
                </Td>
                <Td align="right" className="font-mono tabular text-ink-2">
                  {p.topHitAvailableUsd == null ? "—" : formatCompactUsd(p.topHitAvailableUsd)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] leading-snug text-ink-4" data-boxes-receipt>
        {`all as multiples of the box price · says = ${venueName}'s own expected value per box · returned = the mean prize value of the last 7 days' pulls, typical = the median pull, both in ${basis} when pulled and shown from ${THIN_N} pulls; a typical pull failing the plausibility check is withheld · top prize = the most valuable prize ${venueName} lists in the box · game inferred from the prizes${asOf ? ` · as of ${asOf}` : ""}`}
      </p>
    </Section>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`px-4 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, align, className = "" }: { children: React.ReactNode; align?: "right"; className?: string }) {
  return (
    <td className={`whitespace-nowrap border-b border-line/60 px-4 py-3 ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}
