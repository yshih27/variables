import { StatCard, StatCardRow } from "../StatCard";
import type { IdentityDetail } from "@/lib/data/identityDetail";
import { formatCompactUsd, formatInt } from "@/lib/format";
import { askText, dayShort, latestCompleteMonthly, monthShort, readFloor, venueName } from "@/lib/card/identityView";

/**
 * The four levels: last sale · monthly price · floor · 30d. One row, the venue
 * page's StatCardRow, every card carrying its basis in `sub`.
 *
 * ⚠️ "—" IS A VALUE. A missing monthly price is "—" with the reason under it,
 * never the last sale dressed as a price and never the running month's number.
 * A floor the reader cannot stand behind is "—" with the ask demoted to a
 * receipt line beneath (see `readFloor`).
 */
export function IdentityKpis({ detail }: { detail: IdentityDetail }) {
  const last = detail.sales.at(-1) ?? null;
  const monthly = latestCompleteMonthly(detail.monthly);
  const floor = detail.floor;
  const fr = readFloor(floor);

  // 30d from the reader's own venue split — its clock, not the render's, so
  // this card and the "Where it trades" bars cannot disagree by a day.
  const sales30 = detail.venues.reduce((a, v) => a + v.sales30d, 0);
  const vol30 = detail.venues.reduce((a, v) => a + v.volume30d, 0);
  const venues30 = detail.venues.filter((v) => v.sales30d > 0).length;

  // The month a missing monthly price refers to — the latest COMPLETE month
  // as of the reader's run, named, because "this month" on the 14th reads as
  // the running one.
  const ran = new Date(detail.generatedAt);
  const lastCompleteMonth = new Date(Date.UTC(ran.getUTCFullYear(), ran.getUTCMonth(), 0)).toISOString();

  return (
    <StatCardRow cols={4}>
      <StatCard
        label="Last sale"
        value={last ? formatCompactUsd(last.priceUsd) : "—"}
        sub={last ? `${venueName(last.platform)} · ${dayShort(last.ts)}` : "no sale in the panel"}
      />
      <StatCard
        label="Monthly price"
        value={monthly ? formatCompactUsd(monthly.value) : "—"}
        accent={!!monthly}
        sub={
          monthly
            ? `${monthShort(monthly.ts)} · ${monthly.n} sales · the index's own median`
            : `under 2 sales in ${monthShort(lastCompleteMonth)}`
        }
      />
      <StatCard
        label="Floor"
        value={floor && fr?.headline ? formatCompactUsd(floor.priceUsd) : "—"}
        sub={
          !floor ? (
            "no live listing"
          ) : fr?.headline ? (
            <>
              {venueName(floor.platform)} · lowest live ask
              {fr.anyAggregator ? (
                <span className="block">
                  {floor.coverage
                    .filter((c) => c.source === "aggregator")
                    .map((c) => venueName(c.platform))
                    .join(", ")}{" "}
                  listings via aggregator
                </span>
              ) : null}
            </>
          ) : (
            <>
              no native listing
              {/* The ask, as a receipt: stated, sourced, never a headline. */}
              <span className="block text-ink-3">
                unverified ask {askText(floor.priceUsd)} · aggregator listing
              </span>
            </>
          )
        }
      />
      <StatCard
        label="30d sales"
        value={formatInt(sales30)}
        sub={
          sales30
            ? `${formatCompactUsd(vol30)} volume · ${venues30} venue${venues30 === 1 ? "" : "s"}`
            : "no sale in the last 30 days"
        }
      />
    </StatCardRow>
  );
}
