import { Section } from "../Section";
import type { IdentityDetail } from "@/lib/data/identityDetail";
import { buyLinks } from "@/lib/links/buyLinks";
import { venueColor } from "@/lib/data/platformSeries";
import { formatCompactUsd } from "@/lib/format";
import { askText, readFloor, slabCert, venueName } from "@/lib/card/identityView";

/**
 * Where it trades — which venue clears this card, and what is on offer now.
 *
 * Two answers in one card because they are one question ("where do I go"):
 * the venue split of the last 30 days' sales as bars, then every live listing
 * with its buy link. The link is the buy-links SSOT's first choice for that
 * token (Rarible where the chain is indexed there, else the venue's own item
 * page) — one rule, the card page's rule.
 *
 * ⚠️ A LISTING IS AN ASK, NOT A PRICE. Each is printed with its venue, and the
 * foot says which venues' listings arrive through an aggregator (Beezie's do),
 * because an aggregator ask can be a placeholder — the KPI strip applies the
 * same disclosure before calling any of these a floor.
 */
export function WhereItTrades({ detail }: { detail: IdentityDetail }) {
  const venues = detail.venues;
  const maxSales = Math.max(1, ...venues.map((v) => v.sales30d));
  const listed = detail.tokens
    .filter((t) => t.listing && t.listing.priceUsd > 0)
    .sort((a, b) => a.listing!.priceUsd - b.listing!.priceUsd);
  const fr = readFloor(detail.floor, detail.sales.at(-1)?.priceUsd ?? null);
  const aggregatorVenues = detail.floor?.coverage.filter((c) => c.source === "aggregator").map((c) => venueName(c.platform)) ?? [];

  return (
    <Section title="Where it trades" readMe="where the last 30 days cleared, and every live ask" fill flush>
      <div className="flex min-h-0 flex-1 flex-col">
        <ul className="divide-y divide-line/60">
          {venues.map((v) => (
            <li key={v.platform} className="px-4 py-2.5 sm:px-5">
              <div className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: venueColor(v.platform) }} />
                  <span className="truncate text-ink">{venueName(v.platform)}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-ink-3">
                  <span className="tabular text-ink-2">{v.sales30d}</span> sale{v.sales30d === 1 ? "" : "s"} ·{" "}
                  {/* A venue that holds slabs but cleared none: the count is a
                      measured zero, the volume and share are not figures. */}
                  <span className="tabular text-ink-2">{v.sales30d ? formatCompactUsd(v.volume30d) : "—"}</span> ·{" "}
                  <span className="tabular text-ink-2">{v.sales30d ? `${v.share.toFixed(0)}%` : "—"}</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-none bg-bg-2">
                <div className="h-full" style={{ width: `${(v.sales30d / maxSales) * 100}%`, background: venueColor(v.platform) }} />
              </div>
            </li>
          ))}
          {venues.length === 0 && (
            <li className="px-4 py-2.5 font-mono text-[11px] text-ink-4 sm:px-5">no venue holds a slab of this card</li>
          )}
        </ul>

        <div className="border-t border-line px-4 pt-2.5 pb-1 text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-3 sm:px-5">
          Live listings
        </div>
        {listed.length ? (
          <ul className="divide-y divide-line/60">
            {listed.map((t) => {
              const link = buyLinks({ platform: t.platform, tokenId: t.tokenId }).filter((l) => l.platform !== "solscan")[0] ?? null;
              return (
                <li key={`${t.platform}:${t.tokenId}`} className="flex items-center gap-3 px-4 py-2 text-[12.5px] sm:px-5">
                  <span className="w-[72px] shrink-0 tabular font-semibold text-ink">{askText(t.listing!.priceUsd)}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">
                    {venueName(t.listing!.platform)}
                    {slabCert(t.cert, detail.parts.number) ? (
                      <span className="font-mono text-[11px] text-ink-4"> · cert {slabCert(t.cert, detail.parts.number)}</span>
                    ) : null}
                  </span>
                  {link && (
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`shrink-0 text-[11.5px] transition-colors hover:text-yellow ${link.isRarible ? "text-yellow" : "text-ink-3"}`}
                    >
                      {link.label} ↗
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-2 font-mono text-[11px] text-ink-4 sm:px-5">no live listing</p>
        )}

        <p className="mt-auto border-t border-line px-4 py-2.5 font-mono text-[10.5px] text-ink-4 sm:px-5">
          {fr && aggregatorVenues.length
            ? `${aggregatorVenues.join(", ")} listings via aggregator — asks unverified`
            : "listings are live asks, not clears"}
        </p>
      </div>
    </Section>
  );
}
