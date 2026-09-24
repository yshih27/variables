"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Section } from "./Section";
import { GradeChip } from "./GradeChip";
import { identityHref } from "@/lib/card/identity";
import { askText, dayShort, monthShort, venueName } from "@/lib/card/identityView";
import { formatCompactUsd } from "@/lib/format";
import { WATCHLIST_IDENTITY_MAX, type WatchedIdentityLine } from "@/lib/watch/identityLine";

/**
 * The watchlist's Identities group — every starred card, priced as the vault
 * prices a line: the reference price with its month and n, the floor only when
 * the page's rule would headline it (an aggregator placeholder reads
 * "unverified ask", never a floor), and the last sale. A watched card is a
 * priced card.
 *
 * The stars live in this browser, so the prices are asked for from here: ONE
 * request (`/api/internal/watchlist`) for every starred slug. While it answers,
 * the frame holds the count it is pricing; a slug the reader no longer knows is
 * said once in the foot, not dropped silently.
 */
type Result = { lines: WatchedIdentityLine[]; missing: string[] };

export function WatchedIdentities({ slugs }: { slugs: string[] }) {
  const key = slugs.slice(0, WATCHLIST_IDENTITY_MAX).join("|");
  const [res, setRes] = useState<{ key: string; data: Result | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    const ctl = new AbortController();
    const qs = key.split("|").map((s) => `s=${encodeURIComponent(s)}`).join("&");
    fetch(`/api/internal/watchlist?${qs}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { data?: Result } | null) => setRes({ key, data: b?.data ?? null }))
      .catch(() => {
        if (!ctl.signal.aborted) setRes({ key, data: null });
      });
    return () => ctl.abort();
  }, [key]);

  const data = res && res.key === key ? res.data : undefined;
  // Keep the reader's starring order: most recently starred last in storage → first here.
  const order = new Map(slugs.map((s, i) => [s, i]));
  const lines = data ? [...data.lines].sort((a, b) => (order.get(b.slug) ?? 0) - (order.get(a.slug) ?? 0)) : [];
  const priced = lines.filter((l) => l.price).length;
  const over = slugs.length - Math.min(slugs.length, WATCHLIST_IDENTITY_MAX);

  return (
    <Section
      title="Identities"
      readMe="starred cards, priced the way their pages price them"
      subtitle={
        data
          ? `${lines.length} card${lines.length === 1 ? "" : "s"} · ${priced} with a reference price · floor only when plausible`
          : `pricing ${Math.min(slugs.length, WATCHLIST_IDENTITY_MAX)} starred card${slugs.length === 1 ? "" : "s"}`
      }
      flush
    >
      <div className="scroll-x" data-watched-identities>
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-[0.07em] text-ink-4">
              <th scope="col" className="py-2 pl-4 pr-3 font-medium sm:pl-5">Card</th>
              <th scope="col" className="px-3 py-2 font-medium">Grade</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">Reference</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">Floor</th>
              <th scope="col" className="whitespace-nowrap py-2 pl-3 pr-4 text-right font-medium sm:pr-5">Last sale</th>
            </tr>
          </thead>
          <tbody>
            {data === undefined ? (
              <tr>
                <td colSpan={5} className="px-4 py-3 font-mono text-[11px] text-ink-4 sm:px-5">
                  reading the reference prices…
                </td>
              </tr>
            ) : data === null ? (
              <tr>
                <td colSpan={5} className="px-4 py-3 font-mono text-[11px] text-ink-3 sm:px-5">
                  the prices did not load · reload the page to try again
                </td>
              </tr>
            ) : (
              lines.map((l) => (
                <tr key={l.slug} data-watched-row={l.canonicalSlug} className="border-b border-line/60 transition-colors last:border-0 hover:bg-bg-2">
                  <th scope="row" className="py-2 pl-4 pr-3 text-left font-normal sm:pl-5">
                    <Link href={identityHref(l.canonicalSlug)} className="block max-w-[280px] truncate text-[12.5px] font-semibold text-ink transition-colors hover:text-yellow">
                      {l.name}
                    </Link>
                    <span className="block max-w-[280px] truncate font-mono text-[10.5px] text-ink-4">
                      {[l.setName, l.number ? `#${l.number}` : null].filter(Boolean).join(" · ") || "no set on the card"}
                    </span>
                  </th>
                  <td className="px-3 py-2"><GradeChip label={l.grade} /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular text-[12.5px]">
                    {l.price ? (
                      <>
                        <span className="text-ink">{formatCompactUsd(l.price.priceUsd)}</span>
                        <span className="mt-0.5 flex items-center justify-end gap-1.5 font-mono text-[10px] text-ink-4">
                          {l.price.thin ? (
                            <span className="rounded-md border border-line bg-bg-2 px-1.5 py-0.5 leading-none text-ink-3">thin</span>
                          ) : null}
                          {monthShort(`${l.price.month}-15T00:00:00Z`)} · n {l.price.n}
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-4" title="fewer than two sales in the latest complete month">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular text-[12.5px]">
                    {l.floor ? (
                      <>
                        <span className="text-ink-2">{askText(l.floor.priceUsd)}</span>
                        <span className="block font-mono text-[10px] text-ink-4">{venueName(l.floor.venue)}</span>
                      </>
                    ) : l.unverifiedAsk ? (
                      <span className="font-mono text-[11px] text-ink-3" title="an ask outside the plausible band of this card's price">
                        unverified ask {askText(l.unverifiedAsk.priceUsd)}
                      </span>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 pl-3 pr-4 text-right tabular text-[12.5px] sm:pr-5">
                    {l.lastSale ? (
                      <>
                        <span className="text-ink-2">{formatCompactUsd(l.lastSale.priceUsd)}</span>
                        <span className="block font-mono text-[10px] text-ink-4">{dayShort(l.lastSale.ts)}</span>
                      </>
                    ) : (
                      <span className="text-ink-4">no sale yet</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {data && (data.missing.length > 0 || over > 0) ? (
        <p className="border-t border-line px-4 py-2 font-mono text-[10.5px] text-ink-4 sm:px-5">
          {data.missing.length > 0 ? `${data.missing.length} starred card${data.missing.length === 1 ? " is" : "s are"} no longer priced here` : ""}
          {data.missing.length > 0 && over > 0 ? " · " : ""}
          {over > 0 ? `the first ${WATCHLIST_IDENTITY_MAX} are priced; ${over} more starred` : ""}
        </p>
      ) : null}
    </Section>
  );
}
