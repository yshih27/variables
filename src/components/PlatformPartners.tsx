import { Section } from "./Section";
import { MetricInfo } from "./MetricInfo";
import { formatCompactUsd, formatMonthDayUtc } from "@/lib/format";

/**
 * Top partners — which partner surface a Collector Crypt pull was bought
 * through (CC's `memo_slug`: 'cc' is CC's own storefront, 'rare' is Rarible, …).
 *
 * THREE STATES, and the difference between them is the honesty:
 *   • No rollup at all (`partners` null) or zero attributed rows → render
 *     NOTHING. We have not measured the split, so we say nothing about it.
 *   • Attribution accruing but no partner over the floor → the section header
 *     plus an accrual note (same honest-absence family as "Building history").
 *     Capture is forward-only, so a young, truthful "0.5% attributed" is the
 *     expected state for a while and deserves an explanation, not silence.
 *   • A partner clears the floor → the board, which replaces the note by itself.
 *
 * `memo_slug` capture is forward-only and lands with PR #73; the snapshot carries
 * no partner rollup yet, so today this returns null and lights up on its own once
 * the backend attaches the rollup — no FE change needed.
 *
 * DISPLAY RULES (fixed — do not special-case any individual partner):
 *   • Top 3 by trailing-30d attributed volume, cut at DISPLAY time from the FULL
 *     rollup the backend sends. The component never filters by slug, never
 *     promotes or demotes a named partner, and never reorders by anything but
 *     volume — so a partner entering or leaving the top 3 is purely data.
 *   • A minimum-volume floor from the snapshot's OWN config (never hardcoded
 *     here), applied before the cut, so a $12 partner can't take a podium slot.
 *   • No "Other" row and no total row: the three rows do not sum to the whole,
 *     and a total would invite reading them as if they did.
 *   • Pulls with a NULL memo_slug are unknown origin — they belong to no partner
 *     and are never folded into one. The subtitle's attributed % is what makes
 *     that visible, so it is required, not decorative.
 */
export type PartnerRow = {
  /** CC memo slug, lowercased by the capture ('cc', 'rare', …). */
  slug: string;
  /** Display name when the backend knows one; falls back to the slug. */
  label?: string | null;
  /** Attributed volume over the trailing 30 days, USD. */
  volumeUsd30d: number;
};

export type PartnerAttribution = {
  /** The FULL rollup — every attributed partner. Cut to the top 3 here. */
  rows: PartnerRow[];
  /** Snapshot-owned display config. The floor and the house slug live with the
   *  data, not in the FE — CC's rollup sends `houseSlug: "cc"`. Optional so a
   *  rollup that predates the field still renders (it just filters nothing). */
  config: { minVolumeUsd: number; houseSlug?: string | null };
  /** Share of pulls in the window carrying a memo_slug (0–100). NULL slugs are
   *  unknown origin and are excluded from every partner's volume. */
  attributedPct: number;
  /** When memo_slug capture began — the migration's ship date. Dates the accrual
   *  note so "0.5% attributed" reads as "young", not as "broken". Optional: the
   *  note simply drops the clause when the rollup doesn't carry it. */
  capturedSince?: string | null;
};

const TOP_N = 3;

/** Shared by the board and the accrual note, so the ⓘ reads the same in both. */
function PartnersTitle() {
  return (
    <span className="inline-flex items-center gap-1.5">
      Top partners
      <MetricInfo metric="partnerAttribution" />
    </span>
  );
}

export function PlatformPartners({ partners }: { partners: PartnerAttribution | null | undefined }) {
  if (!partners) return null;

  const floor = Number.isFinite(partners.config?.minVolumeUsd) ? partners.config.minVolumeUsd : 0;
  // The house storefront is not a partner; boards render partner surfaces only.
  // Which slug is the house is the snapshot's call (CC sends "cc"), not a
  // hardcoded name here — that keeps this free of per-partner special-casing.
  const house = (partners.config?.houseSlug ?? "").trim().toLowerCase();
  // Any row with a real volume = attribution is landing, even if no partner is
  // big enough to show yet. That distinction is what picks the state below.
  const attributed = partners.rows.filter((r) => Number.isFinite(r.volumeUsd30d));
  // House out, then floor, then rank, then cut — all on the full rollup, by volume only.
  const top = attributed
    .filter((r) => !house || r.slug.trim().toLowerCase() !== house)
    .filter((r) => r.volumeUsd30d >= floor)
    .sort((a, b) => b.volumeUsd30d - a.volumeUsd30d)
    .slice(0, TOP_N);

  const pct = Number.isFinite(partners.attributedPct) ? partners.attributedPct : 0;

  // Attribution is landing but nothing has cleared the floor yet — say so, with
  // the numbers that make it legible: how long it's been accruing, how much of
  // the feed is attributed, and the bar a partner has to clear. Nothing at all
  // is captured → still render nothing (we measured nothing, so we claim nothing).
  if (!top.length) {
    if (!attributed.length) return null;
    const since = formatMonthDayUtc(partners.capturedSince);
    const note =
      [
        since ? `Partner attribution accruing since ${since}` : "Partner attribution accruing",
        `${fmtAttributedPct(pct)} of pulls attributed`,
        `partners appear at ${formatCompactUsd(floor)}/30d volume`,
      ].join(" · ") + ".";
    return (
      <Section title={<PartnersTitle />} flush className="font-sans">
        <div className="px-4 pb-4 pt-1 sm:px-5 sm:pb-5">
          <div className="flex min-h-[64px] items-center justify-center rounded-lg border border-dashed border-line px-4 py-3 text-center text-[12px] leading-relaxed text-ink-3">
            {note}
          </div>
        </div>
      </Section>
    );
  }

  return (
    <Section
      title={<PartnersTitle />}
      subtitle={`top ${TOP_N} by 30d volume · ${fmtAttributedPct(pct)} of pulls attributed`}
      flush
      className="font-sans"
    >
      <div className="px-4 pb-4 pt-1 sm:px-5 sm:pb-5">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-3">
              <th className="py-1.5 text-left font-medium">Partner</th>
              <th className="py-1.5 text-right font-medium">30d volume</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.slug} className="border-b border-line/50 last:border-b-0">
                <td className="py-2 text-ink-2">{r.label || r.slug}</td>
                <td className="py-2 text-right font-mono tabular text-ink">{formatCompactUsd(r.volumeUsd30d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/**
 * Attributed share of pulls. One decimal below 10% (the early-accrual range,
 * where "3%" and "3.4%" are different stories), whole percent above it.
 *
 * Floors at "<0.1%" and never prints a bare "0%": this only renders when partner
 * rows are visible, so attribution is provably non-zero — a rounded "0%" beside
 * real volume would read as "we attributed nothing", which is false. Forward-only
 * capture means the true figure sits near zero for a long while, so this is the
 * normal case, not an edge case.
 */
function fmtAttributedPct(pct: number): string {
  if (!Number.isFinite(pct) || pct < 0.1) return "<0.1%";
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(0)}%`;
}
