import Link from "next/link";
import { Section } from "../Section";
import { TableFoot } from "../TableFoot";
import { CardThumb } from "../CardThumb";
import { GradeChip } from "../GradeChip";
import { cardHref, cardSupported } from "@/lib/card/ids";
import { formatCompactUsd } from "@/lib/format";
import type { PanelSale } from "@/lib/data/gradeSetPanel";

/**
 * What actually sold in this set — the biggest first, with the card art.
 *
 * ⚠️ THE THUMBNAIL IS THE POINT OF THE ZONE. A set page whose evidence is a
 * column of names asks the reader to take the set's identity on trust; the art is
 * what makes "Pokémon 151" mean something. `CardThumb` holds its frame when an
 * image is dead or absent, so a missing asset leaves a placeholder rather than
 * collapsing the row.
 */
export function SetTopSales({ sales, limit = 12 }: { sales: PanelSale[]; limit?: number }) {
  const top = [...sales].sort((a, b) => b.priceUsd - a.priceUsd).slice(0, limit);
  if (top.length === 0) {
    return (
      <Section title="Top sales" readMe="the biggest clears in this set">
        <p className="text-[12.5px] text-ink-3">No sales in the window.</p>
      </Section>
    );
  }

  return (
    <Section title="Top sales" readMe="the biggest clears in this set" flush>
      <ul className="divide-y divide-line/60">
        {top.map((s) => {
          const body = (
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <CardThumb src={s.image} alt={s.cardName ?? ""} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-ink">{s.cardName ?? "—"}</span>
                <span className="mt-0.5 block font-mono text-[10px] text-ink-4">
                  {s.ts.slice(0, 10)} · {s.platform}
                </span>
              </span>
            </span>
          );
          return (
            <li key={`${s.tokenId}-${s.ts}`} className="flex items-center gap-3 px-4 py-2 sm:px-5">
              {cardSupported(s.platform) ? (
                <Link href={cardHref(s.platform, s.tokenId)} className="flex min-w-0 flex-1 hover:text-yellow">
                  {body}
                </Link>
              ) : (
                body
              )}
              <GradeChip label={s.grade} />
              <span className="w-[84px] shrink-0 text-right tabular text-[12.5px] font-semibold text-ink">
                {formatCompactUsd(s.priceUsd)}
              </span>
            </li>
          );
        })}
      </ul>
      <TableFoot shown={top.length} total={sales.length} noun="sale" />
    </Section>
  );
}
