import { Section } from "../Section";
import type { CharacterVenueRow } from "@/lib/data/characterRollups";
import { venueColor } from "@/lib/data/platformSeries";
import { formatCompactUsd, formatInt } from "@/lib/format";
import { askText, venueName } from "@/lib/card/identityView";
import { characterCheapestClear, venueFloor } from "@/lib/card/characterView";

/**
 * Where it trades — the identity page's card, for a character: the venue split
 * of the last 30 days' sales and volume as bars, then each venue's live
 * listings and lowest ask.
 *
 * ⚠️ A FLOOR IS AN ASK, NOT A PRICE, and its venue's coverage travels with it:
 * a native venue's lowest ask is printed as the floor; an aggregator-sourced
 * one (Beezie's, today) is printed as an unverified ask, in the receipt's
 * words, never as a floor. The foot names the aggregator venues.
 */
export function CharacterWhereItTrades({ venues }: { venues: CharacterVenueRow[] }) {
  const rows = [...venues].sort((a, b) => b.sales30d - a.sales30d || b.listings - a.listings);
  const maxSales = Math.max(1, ...rows.map((v) => v.sales30d));
  const tot = rows.reduce((a, v) => a + v.sales30d, 0);
  const aggregator = rows.filter((v) => v.coverage === "aggregator").map((v) => venueName(v.platform));
  const cheapest = characterCheapestClear(rows);

  return (
    <Section title="Where it trades" readMe="where the last 30 days cleared, and each venue's lowest ask" fill flush>
      <div className="flex min-h-0 flex-1 flex-col">
        <ul className="divide-y divide-line/60">
          {rows.map((v) => {
            const f = venueFloor(v, cheapest);
            return (
            <li key={v.platform} className="px-4 py-2.5 sm:px-5">
              <div className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: venueColor(v.platform) }} />
                  <span className="truncate text-ink">{venueName(v.platform)}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-ink-3">
                  <span className="tabular text-ink-2">{v.sales30d}</span> sale{v.sales30d === 1 ? "" : "s"} ·{" "}
                  <span className="tabular text-ink-2">{v.sales30d ? formatCompactUsd(v.volume30d) : "—"}</span> ·{" "}
                  <span className="tabular text-ink-2">{v.sales30d && tot ? `${((v.sales30d / tot) * 100).toFixed(0)}%` : "—"}</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-none bg-bg-2">
                <div className="h-full" style={{ width: `${(v.sales30d / maxSales) * 100}%`, background: venueColor(v.platform) }} />
              </div>
              <div className="mt-1.5 font-mono text-[10.5px] text-ink-4">
                {v.listings ? (
                  <>
                    <span className="tabular text-ink-3">{formatInt(v.listings)}</span> live listing{v.listings === 1 ? "" : "s"}
                    {/* The floor rule (characterView.venueFloor): a native ask at or
                        above half the cheapest 30d clear is the floor; an aggregator
                        ask is unverified; an ask under half of any clear is a
                        placeholder and is named as one, never as a floor. */}
                    {f ? (
                      f.kind === "floor" ? (
                        <>
                          {" · "}floor <span className="tabular text-ink-2">{askText(f.priceUsd)}</span>
                        </>
                      ) : f.kind === "unverified" ? (
                        <>
                          {" · "}unverified ask <span className="tabular text-ink-3">{askText(f.priceUsd)}</span> · aggregator listing
                        </>
                      ) : f.kind === "placeholder" ? (
                        <>
                          {" · "}asks from <span className="tabular text-ink-3">{askText(f.priceUsd)}</span> · under half the cheapest 30d clear (
                          <span className="tabular">{askText(f.referenceUsd)}</span>) · no floor
                        </>
                      ) : (
                        <>
                          {" · "}lowest ask <span className="tabular text-ink-3">{askText(f.priceUsd)}</span> · no 30d clear to read it against · no floor
                        </>
                      )
                    ) : null}
                  </>
                ) : (
                  "no live listing"
                )}
              </div>
            </li>
            );
          })}
          {rows.length === 0 && (
            <li className="px-4 py-2.5 font-mono text-[11px] text-ink-4 sm:px-5">no venue holds a slab of this character</li>
          )}
        </ul>
        <p className="mt-auto border-t border-line px-4 py-2.5 font-mono text-[10.5px] text-ink-4 sm:px-5">
          {aggregator.length ? `${aggregator.join(", ")} listings via aggregator — asks unverified` : "listings are live asks, not clears"}
        </p>
      </div>
    </Section>
  );
}
