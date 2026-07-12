import Link from "next/link";
import { SubscribeForm } from "./SubscribeForm";

/**
 * App-wide footer (round-3 "trust & identity") — rendered once from the root
 * layout so every page carries the same identity line, the About/Methodology/
 * Status/contact links, and the data disclaimer. Deliberately quiet: one
 * bordered band, no stats, no freshness timestamps (/status owns freshness).
 */
const LINKS: Array<{ label: string; href: string }> = [
  { label: "Methodology", href: "/methodology" },
  { label: "Data status", href: "/status" },
  { label: "Watchlist", href: "/watchlist" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line/70 px-8 py-8 font-sans">
      <div className="mx-auto flex max-w-[1760px] flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-line/50 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[420px] text-[13px] text-ink-2">
            The tokenized-card market, distilled into one email every Monday.
          </p>
          <SubscribeForm source="footer" variant="slim" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <div className="flex items-center gap-2 text-[13px] font-bold tracking-[0.02em]">
            <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-yellow text-[10px] font-extrabold text-black">
              V
            </span>
            <span className="font-mono tracking-[0.04em]">VARIABLE</span>
            <span className="font-normal text-ink-3">· real cards. real prices. indexed</span>
          </div>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink-3">
            {LINKS.map((l) => (
              <Link key={l.label} href={l.href} className="transition-colors hover:text-yellow">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <p className="max-w-3xl text-[11.5px] leading-relaxed text-ink-4">
          Variable tracks prices, volume, and holders across tokenized trading-card platforms. All
          figures are derived from on-chain activity and platform APIs and are informational only —
          nothing here is financial advice. Spotted a wrong number? Corrections route through the{" "}
          <Link href="/methodology" className="text-ink-3 transition-colors hover:text-yellow">
            methodology page
          </Link>
          . A Rarible project.
        </p>
      </div>
    </footer>
  );
}
