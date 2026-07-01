import type { BuyLink } from "@/lib/links/buyLinks";

/**
 * BuyLinks (F5) — the card page's primary CTA. Ordered outbound "buy this card"
 * pills from `buyLinks()`: Rarible first in brand yellow, every other venue
 * neutral. Labels are self-describing ("Buy on Rarible" / "Find on …"). Renders
 * nothing until there's ≥1 link, so it never shows an empty shell. New tab.
 */
export function BuyLinks({ links }: { links: BuyLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {links.map((l) => (
        <a
          key={l.platform}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className={
            l.isRarible
              ? "group inline-flex h-10 items-center gap-2 rounded-xl bg-yellow px-4 text-[14px] font-bold text-black transition-colors hover:bg-yellow-2"
              : "group inline-flex h-10 items-center gap-2 rounded-xl border border-line-2 bg-bg-1 px-4 text-[14px] font-semibold text-ink transition-colors hover:border-ink-3 hover:bg-bg-2"
          }
        >
          {l.label}
          <span className={`text-[12px] transition-transform group-hover:translate-x-0.5 ${l.isRarible ? "opacity-70" : "text-ink-3"}`}>
            ↗
          </span>
        </a>
      ))}
    </div>
  );
}
