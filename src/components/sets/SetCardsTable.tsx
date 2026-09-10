import Link from "next/link";
import { Section } from "../Section";
import { TableFoot } from "../TableFoot";
import { CardThumb } from "../CardThumb";
import { cardHref, cardSupported } from "@/lib/card/ids";
import { formatCompactUsd } from "@/lib/format";
import type { PanelSale } from "@/lib/data/gradeSetPanel";

/**
 * The cards behind a set's volume — grouped by card, not by sale.
 *
 * A DIFFERENT QUESTION from the top-sales strip beside it: that one asks "what
 * were the biggest clears", this one asks "which cards make up the volume".
 * A card that sells eleven times at $200 never appears in a top-sales list and is
 * a bigger part of the set than the one $900 clear that does.
 *
 * ⚠️ GROUPED BY TOKEN, WHICH IS A CARD-COPY, NOT A CARD TYPE. Two graded copies
 * of the same Charizard are two rows because they are two assets with two prices;
 * folding them together would average a PSA 10 into a PSA 7 and print a number
 * that describes neither.
 */
type Row = {
  tokenId: string;
  platform: PanelSale["platform"];
  name: string | null;
  grade: string;
  image: string | null;
  sales: number;
  volumeUsd: number;
  lastUsd: number;
};

export function SetCardsTable({ sales, limit = 12 }: { sales: PanelSale[]; limit?: number }) {
  const by = new Map<string, Row>();
  for (const s of sales) {
    const r = by.get(s.tokenId);
    if (r) {
      r.sales += 1;
      r.volumeUsd += s.priceUsd;
    } else {
      by.set(s.tokenId, {
        tokenId: s.tokenId,
        platform: s.platform,
        name: s.cardName,
        grade: s.grade,
        image: s.image,
        sales: 1,
        volumeUsd: s.priceUsd,
        // `sales` arrives newest-first, so the first row seen is the latest price.
        lastUsd: s.priceUsd,
      });
    }
  }
  const rows = [...by.values()].sort((a, b) => b.volumeUsd - a.volumeUsd);
  const shown = rows.slice(0, limit);

  if (shown.length === 0) {
    return (
      <Section title="Cards" readMe="which cards make up this set's volume" fill>
        <p className="text-[12.5px] text-ink-3">No sales in the window.</p>
      </Section>
    );
  }

  return (
    <Section title="Cards" readMe="which cards make up this set's volume" fill flush>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-[0.07em] text-ink-4">
              <th scope="col" className="py-2 pl-4 pr-3 font-medium sm:pl-5">Card</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Sales</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Volume</th>
              <th scope="col" className="py-2 pl-3 pr-4 text-right font-medium sm:pr-5">Last</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const label = (
                <span className="flex min-w-0 items-center gap-2.5">
                  <CardThumb src={r.image} alt={r.name ?? ""} size={28} />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] text-ink">{r.name ?? "—"}</span>
                    <span className="block font-mono text-[10px] text-ink-4">{r.grade}</span>
                  </span>
                </span>
              );
              return (
                <tr key={r.tokenId} className="border-b border-line/60 last:border-0">
                  <th scope="row" className="py-2 pl-4 pr-3 text-left font-normal sm:pl-5">
                    {cardSupported(r.platform) ? (
                      <Link href={cardHref(r.platform, r.tokenId)} className="block min-w-0 hover:text-yellow">
                        {label}
                      </Link>
                    ) : (
                      label
                    )}
                  </th>
                  <td className="px-3 py-2 text-right tabular text-[12.5px] text-ink-2">{r.sales}</td>
                  <td className="px-3 py-2 text-right tabular text-[12.5px] text-ink">{formatCompactUsd(r.volumeUsd)}</td>
                  <td className="py-2 pl-3 pr-4 text-right tabular text-[12.5px] text-ink-2 sm:pr-5">
                    {formatCompactUsd(r.lastUsd)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <TableFoot shown={shown.length} total={rows.length} noun="card" />
    </Section>
  );
}
