"use client";

import { useState } from "react";
import Link from "next/link";
import { Section } from "../Section";
import { TableFoot } from "../TableFoot";
import { CardThumb } from "../CardThumb";
import type { IdentityToken } from "@/lib/data/identityDetail";
import { formatCompactUsd } from "@/lib/format";
import { askText, dayShort, slabCert, venueName } from "@/lib/card/identityView";

/**
 * The slabs behind the identity — every token, one row each: cert, venue, last
 * sale, listing, and the way to its own page (`/card/<id>`).
 *
 * Top rows by default (the machines table's rule): the first TOP_ROWS of the
 * reader's order — latest sale first — with "Show all N →" in the foot when
 * there are more. Per-visit state, not a stored preference: fifty-five
 * thousand identities is not a set of surfaces a reader configures.
 */
const TOP_ROWS = 15;

export function SlabsTable({
  tokens,
  number,
  name,
  grade,
}: {
  tokens: IdentityToken[];
  number: string | null;
  /** The identity's own name and grade — every slab here is that card, so
   *  the preview captions each thumb with them. */
  name: string;
  grade: string;
}) {
  const [all, setAll] = useState(false);
  const visible = all ? tokens : tokens.slice(0, TOP_ROWS);
  const truncated = visible.length < tokens.length;

  return (
    <Section
      title="Slabs"
      readMe="every tracked copy, latest sale first"
      subtitle={`${tokens.length} slab${tokens.length === 1 ? "" : "s"} · cert where the venue publishes it`}
      flush
    >
      <div className="scroll-x">
        <table className="w-full min-w-0 border-collapse text-[13px] md:min-w-[720px]">
          <thead>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-[0.07em] text-ink-4">
              <th scope="col" className="py-2 pl-4 pr-3 text-left font-medium sm:pl-5">Slab</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Venue</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Last sale</th>
              <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">Listing</th>
              <th scope="col" className="py-2 pl-3 pr-4 text-right font-medium sm:pr-5">
                <span className="sr-only">Page</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr key={`${t.platform}:${t.tokenId}`} className="border-b border-line/60 transition-colors last:border-0 hover:bg-bg-2">
                <th scope="row" className="py-2 pl-4 pr-3 text-left font-normal sm:pl-5">
                  <Link href={`/card/${t.cardId}`} className="flex min-w-0 items-center gap-2.5 hover:text-yellow">
                    <CardThumb src={t.image} variant="row" preview={{ name, grade }} />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[12px] text-ink">
                        {slabCert(t.cert, number) ? `cert ${slabCert(t.cert, number)}` : shortId(t.tokenId)}
                      </span>
                    </span>
                  </Link>
                </th>
                <td className="px-3 py-2 text-[12.5px] text-ink-2">{venueName(t.platform)}</td>
                <td className="px-3 py-2 text-right tabular text-[12.5px]">
                  {t.lastSale ? (
                    <>
                      <span className="text-ink">{formatCompactUsd(t.lastSale.priceUsd)}</span>
                      <span className="block font-mono text-[10.5px] text-ink-4">{dayShort(t.lastSale.ts)}</span>
                    </>
                  ) : (
                    <span className="text-ink-4">—</span>
                  )}
                </td>
                <td className="hidden px-3 py-2 text-right tabular text-[12.5px] sm:table-cell">
                  {t.listing ? (
                    <span className="text-ink-2">{askText(t.listing.priceUsd)}</span>
                  ) : (
                    <span className="text-ink-4">—</span>
                  )}
                </td>
                <td className="py-2 pl-3 pr-4 text-right sm:pr-5">
                  <Link href={`/card/${t.cardId}`} className="font-mono text-[11px] text-ink-3 transition-colors hover:text-yellow">
                    slab →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TableFoot
        shown={visible.length}
        total={tokens.length}
        noun="slab"
        action={
          tokens.length > TOP_ROWS
            ? truncated
              ? { label: `Show all ${tokens.length} →`, onClick: () => setAll(true) }
              : { label: `Show top ${TOP_ROWS}`, onClick: () => setAll(false) }
            : undefined
        }
      />
    </Section>
  );
}

function shortId(s: string): string {
  return s.length <= 14 ? s : `${s.slice(0, 6)}…${s.slice(-4)}`;
}
