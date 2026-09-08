import {
  COVERAGE_LEGS,
  COVERAGE_LEG_LABEL,
  type EconomicsCoverage,
} from "@/lib/data/economicsCoverage";
import { Section } from "../Section";
import { CoverageChip } from "./CoverageChip";

/**
 * Venue × leg: what this page can count, and where it cannot.
 *
 * This replaced the partner and machine tiles that used to close the page. Both
 * were Collector Crypt features that already live on `/platform/collector-crypt`,
 * and ending a MARKET page with two panels about one venue was what made the
 * whole surface read as a breakdown of that venue.
 *
 * ⚠️ THE FRAME IS "WHAT CAN BE COUNTED", NOT "WHO PUBLISHES LESS". Same matrix,
 * two possible voices; this one is also the ask we make of a venue, so a row of
 * "no source" has to read as an open door rather than a scorecard.
 */
export function CoverageMatrix({ coverage }: { coverage: EconomicsCoverage }) {
  if (coverage.rows.length === 0) return null;

  return (
    <Section title="Coverage by venue" readMe="coverage is per leg — spend implies nothing about payouts">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th
                scope="col"
                className="py-2 pr-3 text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-4"
              >
                venue
              </th>
              {COVERAGE_LEGS.map((leg) => (
                <th
                  key={leg}
                  scope="col"
                  className="px-3 py-2 text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-4"
                >
                  {COVERAGE_LEG_LABEL[leg]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coverage.rows.map((row) => (
              <tr key={row.key} className="border-b border-line/60 last:border-0">
                <th
                  scope="row"
                  className="py-2 pr-3 text-left text-[12.5px] font-semibold text-ink"
                >
                  {row.name}
                </th>
                {COVERAGE_LEGS.map((leg) => (
                  <td key={leg} className="px-3 py-2">
                    <CoverageChip cell={row.cells[leg]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The partner ask, stated as coverage rather than as a request. */}
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
        Outbound needs a venue&apos;s payout wallet; venues that share one appear here.
      </p>
    </Section>
  );
}
