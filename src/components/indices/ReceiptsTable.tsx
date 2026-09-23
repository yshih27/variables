"use client";

import { useState } from "react";
import Link from "next/link";
import { Section } from "../Section";
import { TableFoot } from "../TableFoot";
import type { IdentityReceipt } from "@/lib/data/indexReceipts";
import { identityHref, parseIdentitySlug, identityDisplayName } from "@/lib/card/identity";
import { formatCompactUsd } from "@/lib/format";
import { GradeChip } from "../GradeChip";

/**
 * The sample behind one published month — every identity in the step, heaviest
 * first, with both prices and both sale counts.
 *
 * ⚠️ THE ROWS ARE THE BUILDER'S OWN SAMPLE, NOT A RE-DERIVATION. The reader
 * hands over what the blob stored when the step was computed, so the table can
 * only ever agree with the level above it. The step printed in the header is
 * the estimator run on exactly these rows, which is what makes the arithmetic
 * checkable rather than asserted.
 *
 * ⚠️ NAME AND GRADE COME OUT OF THE SLUG, WHICH IS THE KEY. The receipt stores
 * the identity slug, so the display name and grade here are `parseIdentitySlug`
 * over that one string — no second lookup, no second naming rule, and a row
 * whose slug the parser rejects still shows its slug rather than disappearing.
 *
 * Top TOP_ROWS by weight, "Show all N →" in the foot (the machines-table
 * control); per-visit state, not a stored preference.
 */
const TOP_ROWS = 15;

export function ReceiptsTable({ identities, month }: { identities: IdentityReceipt[]; month: string }) {
  const [all, setAll] = useState(false);
  const visible = all ? identities : identities.slice(0, TOP_ROWS);
  const truncated = visible.length < identities.length;
  const totalWeight = identities.reduce((a, r) => a + r.weight, 0);

  return (
    <Section
      title="The cards in this step"
      readMe="every identity priced in both months, heaviest first"
      subtitle={`${identities.length} identit${identities.length === 1 ? "y" : "ies"} · weight = sales in the later month · ${totalWeight} sales in total`}
      flush
    >
      <div className="scroll-x">
        <table className="w-full min-w-0 border-collapse text-left md:min-w-[860px]">
          <thead>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-[0.07em] text-ink-4">
              <th scope="col" className="py-2 pl-4 pr-3 font-medium sm:pl-5">#</th>
              <th scope="col" className="px-3 py-2 font-medium">Card</th>
              <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">Grade</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Price</th>
              <th scope="col" className="hidden px-3 py-2 text-right font-medium md:table-cell">Sales</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Weight</th>
              <th scope="col" className="py-2 pl-3 pr-4 text-right font-medium sm:pr-5">Return</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const parsed = r.slug ? parseIdentitySlug(r.slug) : null;
              const name = parsed ? identityDisplayName(parsed.nameSlug.replace(/-/g, " ")) : r.slug || "—";
              const grade = parsed ? parsed.gradeSlug.replace(/-/g, " ").toUpperCase().replace(/(\d) (\d)/, "$1.$2") : null;
              const ret = (Math.exp(r.logReturn) - 1) * 100;
              return (
                <tr key={`${r.slug}:${i}`} className="border-b border-line/60 transition-colors last:border-0 hover:bg-bg-2">
                  <td className="py-2 pl-4 pr-3 tabular text-[11px] text-ink-4 sm:pl-5">{String(i + 1).padStart(2, "0")}</td>
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    {r.slug ? (
                      <Link href={identityHref(r.slug)} className="block max-w-[320px] truncate text-[12.5px] font-semibold text-ink hover:text-yellow">
                        {name}
                      </Link>
                    ) : (
                      // A v4.1 blob stored the step anonymously; the row is real,
                      // the identity behind it was not recorded. Said, not hidden.
                      <span className="text-[12.5px] text-ink-4">not recorded (pre-v4.2 step)</span>
                    )}
                  </th>
                  <td className="hidden px-3 py-2 sm:table-cell">{grade ? <GradeChip label={grade} /> : <span className="text-ink-4">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular text-[12.5px]">
                    {r.priceFrom > 0 || r.priceTo > 0 ? (
                      <>
                        <span className="text-ink-3">{formatCompactUsd(r.priceFrom)}</span>
                        <span className="text-ink-4"> → </span>
                        <span className="text-ink">{formatCompactUsd(r.priceTo)}</span>
                      </>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </td>
                  <td className="hidden px-3 py-2 text-right tabular text-[12px] text-ink-3 md:table-cell">
                    {r.nFrom || r.nTo ? `${r.nFrom} → ${r.nTo}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular text-[12.5px] text-ink-2">{r.weight}</td>
                  <td className={`py-2 pl-3 pr-4 text-right tabular text-[12.5px] sm:pr-5 ${ret > 0 ? "text-green" : ret < 0 ? "text-red" : "text-ink-3"}`}>
                    {ret >= 0 ? "+" : ""}
                    {ret.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <TableFoot
        shown={visible.length}
        total={identities.length}
        // The rows ARE cards (one identity each) — and "identity" pluralises to
        // "identitys" in the foot's simple pluraliser.
        noun="card"
        action={
          identities.length > TOP_ROWS
            ? truncated
              ? { label: `Show all ${identities.length} →`, onClick: () => setAll(true) }
              : { label: `Show top ${TOP_ROWS}`, onClick: () => setAll(false) }
            : undefined
        }
      />
      <p className="border-t border-line px-4 py-2 font-mono text-[10.5px] text-ink-4 sm:px-5">
        price = that identity&apos;s monthly median · return = its log change into {month}, the quantity the estimator takes the weighted median of
      </p>
    </Section>
  );
}
