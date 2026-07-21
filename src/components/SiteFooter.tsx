import Link from "next/link";
import { SubscribeForm } from "./SubscribeForm";
import { BrandLockup } from "./Brand";
import { XGlyph } from "./XGlyph";
import { X_URL } from "@/lib/site";

/**
 * App-wide footer (round-3 "trust & identity") — rendered once from the root
 * layout so every page carries the same identity line, the About/Methodology/
 * Status/contact links, and the data disclaimer. Deliberately quiet: one
 * bordered band, no stats, no freshness timestamps (/status owns freshness).
 */
// Terms/Privacy go DIRECTLY to Rarible's canonical documents (legal directive
// 7/21 — Varible is governed by the parent policies; we don't maintain our own).
// The old /terms + /privacy routes 308-redirect there for any existing links.
const LINKS: Array<{ label: string; href: string; external?: boolean }> = [
  { label: "Methodology", href: "/methodology" },
  { label: "Data status", href: "/status" },
  { label: "Watchlist", href: "/watchlist" },
  { label: "Terms", href: "https://rarible.com/terms", external: true },
  { label: "Privacy", href: "https://rarible.com/privacy", external: true },
];

/**
 * Verbatim legal disclaimer — LEGAL COPY, must remain byte-identical. Kept as
 * plain string constants (not JSX text) so the exact wording, the curly quotes
 * around “Site”, and every comma survive review: a JS string is reproduced
 * literally, where JSX children can be reflowed or entity-normalized. Two
 * paragraphs → two <p> so the paragraph break renders (a lone "\n" would
 * collapse). Do not edit the text.
 */
const LEGAL_DISCLAIMER: readonly string[] = [
  "IMPORTANT DISCLAIMER: All content provided on our website, hyperlinked sites, associated applications, forums, blogs, social media accounts and other platforms (the “Site”) is for general informational purposes only and is procured primarily from publicly available information and other third-party sources. Unless expressly stated otherwise, Rarible is not affiliated with, endorsed by, sponsored by, or otherwise associated with any third party whose data, content, products, services, websites, links, or intellectual property may be displayed, referenced, or linked to on the Site. We make no warranties or representations of any kind in relation to the content available on the Site, including, without limitation, its accuracy, completeness, reliability, security, or timeliness. No part of the content provided on the Site constitutes financial, investment, legal, tax or other professional advice, nor any dealing in (or promotion of) securities. Any use of or reliance on the content is solely at your own risk and discretion. You should conduct your own research, review, analyse and verify any information before relying on it. Trading and investing in digital assets involve significant risk and may result in substantial losses. No content on this Site is intended to constitute a solicitation, offer, or recommendation to buy, sell, or transact in any asset.",
  "The Site may display references to third-party brands, trademarks, trade names, logos, characters, artwork, product names, and other intellectual property solely for purposes of identifying, describing, categorizing, indexing, searching for, discovering, or facilitating user-generated content and marketplace activity. All such intellectual property is the property of its respective owner. Rarible does not own nor claim any rights in such intellectual property, and the display of any such materials does not imply any affiliation, sponsorship, endorsement, authorization, or approval by the applicable rights holder.",
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line/70 px-8 py-8 font-sans">
      <div className="mx-auto flex max-w-[1760px] flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-line/50 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[420px] text-[13px] text-ink-2">
            The tokenized-card market, distilled into one email every Monday.
          </p>
          <SubscribeForm source="footer" variant="slim" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <div className="flex items-center gap-2.5 text-[13px]">
            <BrandLockup className="h-[15px] w-auto text-ink" title="VARIBLE" />
            <span className="text-ink-3">· real cards. real prices. indexed</span>
          </div>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink-3">
            {LINKS.map((l) =>
              l.external ? (
                <a
                  key={l.label}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-yellow"
                >
                  {l.label}
                </a>
              ) : (
              <Link key={l.label} href={l.href} className="transition-colors hover:text-yellow">
                {l.label}
              </Link>
              ),
            )}
            <a
              href={X_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Varible on X"
              className="inline-flex items-center transition-colors hover:text-yellow"
            >
              <XGlyph />
            </a>
          </nav>
        </div>
        <p className="max-w-3xl text-[11.5px] leading-relaxed text-ink-4">
          Varible tracks prices, volume, and holders across tokenized trading-card platforms. All
          figures are derived from on-chain activity and platform APIs. Spotted a wrong number?
          Corrections route through the{" "}
          <Link href="/methodology" className="text-ink-3 transition-colors hover:text-yellow">
            methodology page
          </Link>
          . A Rarible project.
        </p>
        {/* Formal legal disclaimer — verbatim fine print, full text, still on every
            page. Compacted to ~a third of the height: full content width, CSS
            multi-column (1 → 2 → 3 as the viewport grows), ~10px, tight leading,
            dimmer ink. The two paragraphs FLOW across the columns (deliberately NOT
            break-inside-avoid): with only two paragraphs, keeping each whole leaves
            the third column empty and barely cuts the height (measured 0.84×);
            letting them balance fills all three columns at ~1/3. LEGAL_DISCLAIMER is
            byte-identical legal copy — layout only, never edit the wording. */}
        <div className="columns-1 gap-x-8 border-t border-line/40 pt-3 md:columns-2 lg:columns-3">
          {LEGAL_DISCLAIMER.map((para, i) => (
            <p key={i} className="mb-2 text-[10px] leading-snug text-ink-4/75 last:mb-0">
              {para}
            </p>
          ))}
        </div>
      </div>
    </footer>
  );
}
