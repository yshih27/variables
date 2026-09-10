import Link from "next/link";
import { Section } from "../Section";
import { TableFoot } from "../TableFoot";
import { formatCompactUsd, formatDelta, deltaDir } from "@/lib/format";
import type { SetRow } from "@/lib/data/gradeSetPanel";
import type { PublishedEntity } from "@/lib/data/gradeSetIndex";

/**
 * Which sets carry the resale market.
 *
 * ⚠️ THE ROWS ARE CANONICAL SETS, NOT RAW STRINGS. `set_name` off the cards table
 * is dirty — 851 distinct values for Pokémon in ninety days, with three spellings
 * of "Pokémon 151" and a bare "-" among the busiest. Every row here has been
 * through `setKeyOf`, so the three spellings are one row and the junk values are
 * in no row at all.
 *
 * ⚠️ MOST SETS HAVE NO INDEX AND THAT IS THE COMMON CASE, not an error. An index
 * needs identities priced in consecutive months; a set can carry real volume and
 * still never price the same card twice. Those rows show volume and sales and an
 * empty index column, and the readMe says so before the reader reaches the table.
 */
export function SetLeaderboard({
  rows,
  indices,
  ip,
  windowLabel,
  limit = 30,
}: {
  rows: SetRow[];
  /** Published `set:<ip>:<set_key>` entities, keyed by set_key. */
  indices: Map<string, PublishedEntity>;
  ip: string;
  windowLabel: string;
  limit?: number;
}) {
  const shown = rows.slice(0, limit);
  const withIndex = shown.filter((r) => indices.has(r.setKey)).length;

  if (shown.length === 0) {
    return (
      <Section title="By set" readMe="which sets carry the resale market">
        <p className="text-[12.5px] text-ink-3">No resales with a recognisable set in the window.</p>
      </Section>
    );
  }

  const money = (n: number) => (Number.isFinite(n) ? formatCompactUsd(n) : "—");

  return (
    <Section
      title="By set"
      readMe={
        withIndex > 0
          ? "volume everywhere, a price index only where cards resell"
          : "volume and sales only — no set prices the same card twice yet"
      }
      subtitle={`${windowLabel} · ${withIndex} of ${shown.length} sets clear the identity floor for an index`}
      flush
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-[0.07em] text-ink-4">
              <th scope="col" className="py-2 pl-4 pr-3 font-medium sm:pl-5">#</th>
              <th scope="col" className="px-3 py-2 font-medium">Set</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Resale vol</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Sales</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Cards</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Median price</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Index</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">1m</th>
              <th scope="col" className="py-2 pl-3 pr-4 font-medium sm:pr-5">Top sale</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const idx = indices.get(r.setKey) ?? null;
              const d = idx?.changePct1m ?? null;
              return (
                <tr key={r.setKey} className="border-b border-line/60 last:border-0">
                  <td className="py-2 pl-4 pr-3 tabular text-[11px] text-ink-4 sm:pl-5">
                    {String(i + 1).padStart(2, "0")}
                  </td>
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <Link
                        href={`/ip/${ip}/sets/${r.setKey}`}
                        className="truncate text-[12.5px] font-semibold text-ink hover:text-yellow"
                      >
                        {r.name}
                      </Link>
                      {idx && <span className="shrink-0 font-mono text-[10px] text-ink-4">{idx.ticker}</span>}
                    </span>
                  </th>
                  <td className="px-3 py-2 text-right tabular text-[12.5px] text-ink">{money(r.volumeUsd)}</td>
                  <td className="px-3 py-2 text-right tabular text-[12.5px] text-ink-2">{r.sales}</td>
                  <td className="px-3 py-2 text-right tabular text-[12.5px] text-ink-2">{r.cards}</td>
                  <td className="px-3 py-2 text-right tabular text-[12.5px] text-ink-2">{money(r.medianPriceUsd)}</td>
                  <td className="px-3 py-2 text-right tabular text-[12.5px] text-ink-2">
                    {idx?.level != null ? idx.level.toFixed(1) : <span className="text-ink-4">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular text-[12.5px]">
                    {d == null ? (
                      <span
                        className="text-ink-4"
                        title={idx == null ? "no published index for this set" : "not two adjacent published months"}
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
                        <span className="min-w-0 truncate text-ink-2">{r.topSale.name ?? "—"}</span>
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
      <TableFoot shown={shown.length} total={rows.length} noun="set" />
    </Section>
  );
}
