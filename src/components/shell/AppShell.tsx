import Link from "next/link";
import { BrandLockup, BrandMark } from "@/components/Brand";
import { SiteFooter } from "@/components/SiteFooter";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { buildRailModel } from "@/lib/data/railModel";
import { BottomTabs } from "./BottomTabs";
import { RailNav } from "./RailNav";
import { ShellSearch } from "./ShellSearch";
import { TickerStat } from "./TickerStat";
import { RAIL_PREF_SCRIPT } from "./railPref";

/**
 * SHELL_V2 — the terminal frame (north-star Moves 1–4, S1: frame + rail).
 *
 * A SERVER component mounted once from `layout.tsx`, so its two cached reads
 * (rail model + market strip) happen once per window rather than once per page,
 * and — because it sits OUTSIDE the page's Suspense boundary — the rail is
 * already populated in the HTML while `loading.tsx` is still standing in for the
 * content. That is the brief's "the rail must never show a skeleton on a warm
 * path", and it falls out of where the component is mounted rather than needing
 * a second cache.
 *
 * Both reads are total (they return an empty model / [] rather than throwing):
 * chrome on every route must not be able to take a page down.
 *
 * ⚠️ NO CLIENT FETCH ON THE CRITICAL PATH. The studio's seeded first paint
 * (PR #102) is the thing this must not regress — the rail and the strip are
 * server-rendered from cache, and the client leaves below only read pathname,
 * keyboard and storage.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const [rail, ticker] = await Promise.all([buildRailModel(), buildMarketTicker()]);

  return (
    <div className="shell-root font-sans">
      {/* Stamps data-rail on <html> BEFORE paint, so a stored "icons" doesn't
          render a 240px rail and snap it to 56px. */}
      <script dangerouslySetInnerHTML={{ __html: RAIL_PREF_SCRIPT }} />

      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-bg-2 focus:px-3 focus:py-2 focus:text-[13px] focus:text-ink focus:outline-none focus:ring-2 focus:ring-yellow/60"
      >
        Skip to content
      </a>

      {/* ── Top bar: brand · search · strip · star, ONE row ─────────────────
          The P1-C market strip moved in here from its own 38px band, so the
          chrome is 56px total instead of 65 + 38. */}
      <header className="sticky top-0 z-40 flex h-[var(--shell-topbar-h)] items-center gap-3 border-b border-line/70 bg-bg/80 px-4 backdrop-blur-xl sm:px-5">
        <Link href="/" aria-label="VARIBLE — home" className="flex shrink-0 items-center text-ink">
          <BrandMark className="h-[20px] w-auto sm:hidden" />
          <BrandLockup className="hidden h-[20px] w-auto sm:block" />
        </Link>

        <ShellSearch />

        {/* The strip takes the bar's right half on desktop. Its own `priority`
            rule keeps V-MKT + Cap below sm and hides the rest. */}
        <div className="scroll-x ml-auto flex min-w-0 items-center gap-x-5 overflow-x-auto">
          {ticker.map((it) => (
            <TickerStat key={it.label} item={it} />
          ))}
        </div>

        <Link
          href="/watchlist"
          aria-label="Watchlist"
          title="Watchlist"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line/70 bg-bg-1 text-[13px] text-ink-3 transition-colors hover:text-yellow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
        >
          <span aria-hidden>★</span>
        </Link>
      </header>

      {/* ── Rail ‖ content ──────────────────────────────────────────────────
          One grid column driven by --shell-rail-w (globals.css): 240px at ≥1280,
          56px at 1024–1279 or when the reader collapsed it, 0 below 1024 where
          BottomTabs takes over. The content column keeps each page's own
          max-width and padding — the shell never re-wraps page composition. */}
      <div className="shell-grid">
        <RailNav model={rail} />
        <div className="min-w-0">
          <main id="content">{children}</main>
          <SiteFooter />
        </div>
      </div>

      <BottomTabs />
    </div>
  );
}
