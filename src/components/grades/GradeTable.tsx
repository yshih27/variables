import Link from "next/link";
import { Section } from "../Section";
import { TableFoot } from "../TableFoot";
import { GradeChip } from "../GradeChip";
import { cardHref, cardSupported } from "@/lib/card/ids";
import { formatCompactUsd, formatDelta, deltaDir } from "@/lib/format";
import type { GradeRow } from "@/lib/data/gradeSetPanel";
import type { PublishedEntity } from "@/lib/data/gradeSetIndex";

/**
 * Grade by grade: what traded, at what price, and what the index says it is worth.
 *
 * ⚠️ TWO SCOPES IN ONE TABLE, LABELLED. The left columns are THIS IP's resales
 * over the window; the index level and its month-over-month move are the
 * MARKET-WIDE `grade:<label>` entity, because that is what the blob publishes —
 * a grade index is built across every IP that trades in it. The header says so
 * rather than leaving a reader to assume both halves share a denominator.
 *
 * ⚠️ "—" WHERE THERE IS NO INDEX, never a level carried over from a neighbouring
 * grade or a 0. Two of the six grades that trade here clear the identity floor;
 * the other four have a real volume column and an honestly empty index column.
 */
export function GradeTable({
  rows,
  indices,
  windowLabel,
}: {
  rows: GradeRow[];
  /** Market-wide published grade entities, by grade label. */
  indices: Map<string, PublishedEntity>;
  windowLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <Section title="By grade" readMe="what traded, and what the index says it is worth">
        <p className="text-[12.5px] text-ink-3">No resales in the window.</p>
      </Section>
    );
  }

  const money = (n: number) => (Number.isFinite(n) ? formatCompactUsd(n) : "—");

  return (
    <Section
      title="By grade"
      readMe="what traded, and what the index says it is worth"
      subtitle={`Volume, sales and price are this IP over ${windowLabel}. Index level and 1m change are the market-wide grade index, monthly.`}
      flush
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-[0.07em] text-ink-4">
              <th scope="col" className="py-2 pl-4 pr-3 font-medium sm:pl-5">Grade</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Resale vol</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Sales</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Median price</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Share</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Index</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">1m</th>
              <th scope="col" className="py-2 pl-3 pr-4 font-medium sm:pr-5">Top sale</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const idx = indices.get(r.grade) ?? null;
              const d = idx?.changePct1m ?? null;
              return (
                <tr key={r.grade} className="border-b border-line/60 last:border-0">
                  <th scope="row" className="py-2 pl-4 pr-3 text-left font-normal sm:pl-5">
                    <span className="inline-flex items-center gap-2">
                      <GradeChip label={r.grade} />
                      {idx && (
                        <span className="font-mono text-[10px] text-ink-4">{idx.ticker}</span>
                      )}
                    </span>
                  </th>
                  <td className="px-3 py-2 text-right tabular text-[12.5px] text-ink">{money(r.volumeUsd)}</td>
                  <td className="px-3 py-2 text-right tabular text-[12.5px] text-ink-2">{r.sales}</td>
                  <td className="px-3 py-2 text-right tabular text-[12.5px] text-ink-2">{money(r.medianPriceUsd)}</td>
                  <td className="px-3 py-2 text-right tabular text-[12.5px] text-ink-2">{r.sharePct.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right tabular text-[12.5px] text-ink-2">
                    {idx?.level != null ? idx.level.toFixed(1) : <span className="text-ink-4">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular text-[12.5px]">
                    {d == null ? (
                      <span
                        className="text-ink-4"
                        title={
                          idx == null
                            ? "no published index for this grade"
                            : idx.monthGap > 1
                              ? `${idx.monthGap} months between the last two published points — not a one-month move`
                              : "only one published month"
                        }
                      >
                        —
                      </span>
                    ) : (
                      <span className={deltaDir(d) === "up" ? "text-green" : deltaDir(d) === "down" ? "text-red" : "text-ink-3"}>
                        {formatDelta(d)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pl-3 pr-4 text-[12.5px] sm:pr-5">
                    {r.topSale ? (
                      <span className="flex min-w-0 items-baseline gap-2">
                        {cardSupported(r.topSale.platform) ? (
                          <Link
                            href={cardHref(r.topSale.platform, r.topSale.tokenId)}
                            className="min-w-0 truncate text-ink-2 hover:text-yellow"
                          >
                            {r.topSale.name ?? "—"}
                          </Link>
                        ) : (
                          <span className="min-w-0 truncate text-ink-2">{r.topSale.name ?? "—"}</span>
                        )}
                        <span className="shrink-0 tabular text-ink-4">{money(r.topSale.priceUsd)}</span>
                      </span>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <TableFoot shown={rows.length} total={rows.length} noun="grade" />
    </Section>
  );
}
