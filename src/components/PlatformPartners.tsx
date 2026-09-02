import { Section } from "./Section";
import { MetricInfo } from "./MetricInfo";
import { formatCompactUsd } from "@/lib/format";

/**
 * Top partners — which partner surface a Collector Crypt pull was bought
 * through (CC's `memo_slug`: 'cc' is CC's own storefront, 'rare' is Rarible, …).
 *
 * ⚠️ TWO ABSENCES, TWO BEHAVIOURS. `memo_slug` capture is forward-only (PR #73,
 * live 2026-08-18), so the board spends a long time under-populated:
 *   • NO rollup at all (`partners` null) → render nothing. Either the platform
 *     emits no memo_slug or the warmer has not reached it; we cannot tell which,
 *     and an empty board would assert we measured the split and found none.
 *   • A rollup exists but no EXTERNAL partner has attributed volume yet → render
 *     the ACCRUAL NOTE. Here we CAN say something true and useful: capture is
 *     running and this much is attributed so far. That is a state, not a blank.
 * The note also rides along beneath a populated board, because a podium drawn
 * from a low attributed share is exactly where a reader most needs to know the
 * denominator is still filling.
 *
 * DISPLAY RULES (fixed — do not special-case any individual partner):
 *   • Top 5 by trailing-30d attributed volume, cut at DISPLAY time from the FULL
 *     rollup the backend sends. The component never filters by slug, never
 *     promotes or demotes a named partner, and never reorders by anything but
 *     volume — so a partner entering or leaving the top 5 is purely data.
 *   • ⚠️ NO VOLUME FLOOR (product decision, round 5). Every attributed slug is
 *     eligible by size; the floor had been doing double duty as a sufficiency
 *     gate it was never sized for. The snapshot still SENDS
 *     `config.minVolumeUsd` — that is the backend contract and is left alone —
 *     the display simply does not use it as a gate.
 *   • ⚠️ A PLATFORM'S OWN STOREFRONT IS A CHANNEL, NOT A PARTNER — it never
 *     appears on its own board (product decision, round 6; supersedes round 5's
 *     "no slug filter"). Pulls routed through Collector Crypt's own `cc` surface
 *     are house traffic: listing them beside Jupiter and Slabz would rank the
 *     platform against its partners on a board titled "Top partners", and the
 *     house channel would win every time by construction. This is a rule about
 *     the ROLE a slug plays, not about any particular partner — no named partner
 *     is promoted or demoted, and every external slug is still eligible.
 *     ⚠️ THE EXCLUSION IS DISPLAY-ONLY AND MUST NOT REACH THE CAPTURE FIGURE.
 *     "N% of pulls attributed" measures how much of the pull feed carries a
 *     memo_slug at all — it is a CAPTURE metric, not a partner-mix metric — so
 *     own-storefront pulls keep counting toward it. Subtracting them there would
 *     understate capture and make the board look less trustworthy than it is.
 *   • No "Other" row and no total row: the rows do not sum to the whole, and a
 *     total would invite reading them as if they did.
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
  /** The FULL rollup — every attributed slug, house channel included. The board
   *  drops the house slug and cuts to the top 5 at DISPLAY time. */
  rows: PartnerRow[];
  /** Snapshot-owned display config. `houseSlug` is the platform's OWN storefront
   *  ("cc" for Collector Crypt) and is what the board excludes; it is preferred
   *  over the FE's PLATFORM_OWN_SLUG fallback. `minVolumeUsd` is still received
   *  and deliberately unused (see the display rules). Optional so a rollup that
   *  predates either field still renders. */
  config: { minVolumeUsd: number; houseSlug?: string | null };
  /** Share of pulls in the window carrying a memo_slug (0–100). NULL slugs are
   *  unknown origin and are excluded from every partner's volume. */
  attributedPct: number;
};

const TOP_N = 5;

/**
 * A platform's own storefront slug — the channel that is the platform itself.
 *
 * ⚠️ FE-OWNED, AND ONLY AS A FALLBACK. The snapshot's `config.houseSlug` already
 * carries this for Collector Crypt ("cc"), and that is preferred wherever present:
 * a platform that starts emitting memo_slug should light up without an edit here.
 * This map exists so the rule still holds for a rollup that predates the field,
 * and it should shrink to nothing once every rollup carries one. Adding a platform
 * here is not special-casing a PARTNER — it names which slug is the HOUSE.
 */
const PLATFORM_OWN_SLUG: Record<string, string> = {
  "collector-crypt": "cc",
};

/**
 * Slugs are wire codes; the board renders names.
 *
 * ⚠️ ONLY CONFIRMED PARTNERS GET AN ENTRY — the same rule the backend's
 * PARTNER_LABELS follows. A guessed brand name on a published board is a
 * fabrication, and the slug itself is honest, so an unknown code falls back to a
 * capitalized form of the slug rather than a plausible-looking invention. The raw
 * slug stays in every row's `title` so a reader who knows the memo codes can
 * always check what was actually captured.
 */
const PARTNER_DISPLAY: Record<string, string> = {
  jupiter: "Jupiter",
  slabz: "Slabz",
  sol: "Solana",
  comic: "ComicBook",
};

/** Documented fallback for an unknown slug: capitalize it. Not a guess at a brand
 *  — just the code, made presentable. */
function capitalizeSlug(slug: string): string {
  return slug.length ? slug[0].toUpperCase() + slug.slice(1) : slug;
}

/** Backend label first (it knows Rarible / Collector Crypt), then our map, then the
 *  documented fallback. */
function partnerName(row: PartnerRow): string {
  return row.label || PARTNER_DISPLAY[row.slug] || capitalizeSlug(row.slug);
}

/** Rows the board always draws. Real partners fill from the top; the remainder are
 *  dimmed placeholders so the card sits full-height beside Volume mix instead of
 *  looking vacant.
 *
 *  ⚠️ PLACEHOLDERS MUST BE UNMISTAKABLY NOT-DATA. They carry an em dash for the
 *  name and a stated reason — never a number, never a slug, never a zero. A greyed
 *  row that looked like a partner with no volume would assert we measured a partner
 *  and found nothing, which is the opposite of what is true: the slot is empty
 *  because attribution has not reached it yet. */
const PLACEHOLDER_TEXT = "no attribution yet";

/**
 * When memo_slug capture went live (PR #73). Attribution is forward-only, so this
 * date is what makes a low attributed share legible: it is elapsed capture time,
 * not a measurement of partner concentration.
 *
 * ⚠️ BELONGS IN THE SNAPSHOT. Every other display rule here reads from
 * `partners.config` precisely so the FE holds no policy; this one is a constant
 * only because the rollup does not carry a capture-start field yet. Move it to
 * `config.captureStartedAt` when the backend can supply it, and delete this.
 */
const CAPTURE_START_LABEL = "Aug 18";

export function PlatformPartners({
  partners,
  platformKey,
}: {
  partners: PartnerAttribution | null | undefined;
  /** Which platform's board this is — selects the own-storefront slug to exclude. */
  platformKey?: string;
}) {
  if (!partners) return null;

  // Snapshot config wins; the FE map is the fallback for a rollup without it.
  const ownSlug = (
    partners.config?.houseSlug ??
    (platformKey ? PLATFORM_OWN_SLUG[platformKey] : undefined) ??
    ""
  )
    .trim()
    .toLowerCase();

  // Drop the house channel, then rank, then cut. A row still needs a real volume
  // to be ranked at all, which is the only other thing filtered.
  const top = partners.rows
    .filter((r) => !ownSlug || r.slug.trim().toLowerCase() !== ownSlug)
    .filter((r) => Number.isFinite(r.volumeUsd30d) && r.volumeUsd30d > 0)
    .sort((a, b) => b.volumeUsd30d - a.volumeUsd30d)
    .slice(0, TOP_N);

  // ⚠️ Computed from the UNFILTERED figure the snapshot sent — see the display
  // rules. Capture is capture; the own-storefront exclusion is a display rule.
  const pct = Number.isFinite(partners.attributedPct) ? partners.attributedPct : 0;
  const accrual = `attribution accruing since ${CAPTURE_START_LABEL} · ${fmtAttributedPct(pct)} attributed`;

  // Nothing attributed yet → the accrual state IS the content. Capture is
  // demonstrably running (a rollup exists), so this says where it has got to
  // rather than leaving a gap the reader has to interpret.
  if (!top.length) {
    return (
      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            Top partners
            <MetricInfo metric="partnerAttribution" />
          </span>
        }
        readMe="which storefronts route pulls here · attribution grows as capture accrues"
        className="font-sans"
      >
        <div className="flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line px-4 py-4 text-center">
          <span className="text-[12px] text-ink-3">No attributed partners yet</span>
          <span className="font-mono text-[10.5px] leading-snug text-ink-4">{accrual}</span>
        </div>
      </Section>
    );
  }

  return (
    <Section
      title={
        <span className="inline-flex items-center gap-1.5">
          Top partners
          <MetricInfo metric="partnerAttribution" />
        </span>
      }
      readMe="which storefronts route pulls here · attribution grows as capture accrues"
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
                <td className="py-2 text-ink-2" title={`memo_slug: ${r.slug}`}>
                  {partnerName(r)}
                </td>
                <td className="py-2 text-right font-mono tabular text-ink">{formatCompactUsd(r.volumeUsd30d)}</td>
              </tr>
            ))}
            {Array.from({ length: Math.max(0, TOP_N - top.length) }).map((_, i) => (
              <tr key={`awaiting-${i}`} className="border-b border-line/50 last:border-b-0">
                <td className="py-2 text-ink-4">—</td>
                <td className="py-2 text-right font-mono text-[11px] text-ink-4">
                  {PLACEHOLDER_TEXT}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Same accrual note under a populated board. A podium built from a small
            attributed share is the case most likely to be screenshotted and read
            as settled partner share — the denominator has to travel with it. */}
        <p className="mt-3 font-mono text-[10.5px] leading-snug text-ink-4">{accrual}</p>
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
