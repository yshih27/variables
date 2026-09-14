import Link from "next/link";
import { Section } from "../Section";
import { GradeChip } from "../GradeChip";
import type { GradeRung } from "@/lib/data/identityDetail";
import { identityHref } from "@/lib/card/identity";
import { formatCompactUsd } from "@/lib/format";
import { monthShort } from "@/lib/card/identityView";

/**
 * The grade ladder — the same card at every grade the panel knows, one row each,
 * this page's grade highlighted. The "different grades" question, answered per
 * card rather than market-wide.
 *
 * ⚠️ THE PRICE IS THE LATEST COMPLETE MONTH OR NOTHING. A rung whose latest
 * monthly price is the running month prints "—" with "provisional · n sales"
 * beside it, the same rule as the KPI: a headline number is a published one.
 *
 * ⚠️ THE PREMIUM IS THE PUBLISHED PAIR, VERBATIM. "PSA 10 = 3.5× PSA 9 · 76
 * matched" is the price-index blob's matched-identity ratio for the latest
 * published month, read by the backend — the same number the grade page's
 * premium chart draws. Where no pair covers the two grades the cell is empty,
 * not a ratio of two medians (that would be a different, unmatched claim).
 *
 * Rows link to the sibling identity's page; the current grade is text, not a
 * link to itself. The note at the foot anchors to the bottom so the card fills
 * its §7 frame with a receipt rather than a blank band.
 */
export function GradeLadder({ ladder, thisGrade }: { ladder: GradeRung[]; thisGrade: string }) {
  const anyPremium = ladder.some((r) => r.premiumVsThis);
  return (
    <Section title="Grade ladder" readMe="the same card, every grade, matched premiums" fill flush>
      <div className="flex min-h-0 flex-1 flex-col">
        <ul className="divide-y divide-line/60">
          {ladder.map((r) => {
            const m = r.latestMonthly;
            const price = m && !m.partial ? formatCompactUsd(m.value) : "—";
            const priceSub = m ? (m.partial ? `${monthShort(m.ts)} · provisional · ${m.n} sale${m.n === 1 ? "" : "s"}` : `${monthShort(m.ts)} · ${m.n} sale${m.n === 1 ? "" : "s"}`) : "no priced month";
            const inner = (
              <>
                <span className="w-[92px] shrink-0">
                  <GradeChip label={r.grade} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block tabular text-[14px] font-semibold ${price === "—" ? "text-ink-4" : "text-ink"}`}>{price}</span>
                  <span className="block font-mono text-[10.5px] text-ink-4">{priceSub}</span>
                </span>
                <span className="hidden min-w-0 shrink-0 text-right font-mono text-[11px] text-ink-3 sm:block">
                  {r.premiumVsThis ? (
                    // Quoted as the dearer grade over the cheaper — "PSA 10 =
                    // 3.6× PSA 9" on both grades' pages — the way a premium is
                    // said; the backend's ratio is this-over-rung and is
                    // inverted for the reading only, never for the number's
                    // source.
                    <>
                      <span className="text-ink-2">{r.premiumVsThis.ratio >= 1 ? thisGrade : r.grade}</span> ={" "}
                      <span className="tabular text-ink">{(r.premiumVsThis.ratio >= 1 ? r.premiumVsThis.ratio : 1 / r.premiumVsThis.ratio).toFixed(1)}×</span>{" "}
                      <span className="text-ink-2">{r.premiumVsThis.ratio >= 1 ? r.grade : thisGrade}</span>
                      <span className="block text-ink-4">{r.premiumVsThis.n} matched · {monthShort(r.premiumVsThis.month + "-15")}</span>
                    </>
                  ) : r.isThis ? (
                    <span className="text-ink-4">this page</span>
                  ) : null}
                </span>
                {!r.isThis && <span aria-hidden className="shrink-0 font-mono text-[11px] text-ink-4">→</span>}
              </>
            );
            const cls = "flex items-center gap-3 px-4 py-2.5 sm:px-5";
            return (
              <li key={r.grade}>
                {r.isThis ? (
                  <div className={`${cls} bg-bg-2`} aria-current="page">
                    {inner}
                  </div>
                ) : (
                  <Link href={identityHref(r.slug)} className={`${cls} transition-colors hover:bg-bg-2 hover:text-yellow`}>
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-auto border-t border-line px-4 py-2.5 font-mono text-[10.5px] text-ink-4 sm:px-5">
          {anyPremium
            ? "premium = matched-identity ratio, latest published month · price = latest complete month"
            : "no published premium pair covers these grades · price = latest complete month"}
        </p>
      </div>
    </Section>
  );
}
