import type { ReactNode } from "react";

/**
 * Section (QA-4) — the ONE content-module frame for the whole app: a bordered
 * card with the title top-left inside it, an optional subtitle and right-aligned
 * controls, then the module's body. Replaces the mix of "card-with-title-inside"
 * (charts) and "naked floating title" (treemap, tables) that made pages read as
 * three different treatments. Purely presentational, so it works in both server
 * and client modules.
 *
 * `flush` lets a table's body run edge-to-edge (its own cells carry the inset)
 * while the header keeps the card's padding.
 */

/** The bare card frame — for the rare headerless module (the homepage
 *  MarketHeader hero) so even those share one source of frame truth (D1). */
export function SectionShell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-line bg-bg-1 ${className ?? ""}`}>
      {children}
    </section>
  );
}

/**
 * ReadMe — the "how to read this" line that sits directly under a surface's
 * title, above any window/coverage/basis note.
 *
 * House voice: lowercase, mono, analytical, no hype. It states the CONCLUSION a
 * fluent reader would draw from the surface, not an inventory of what the
 * surface contains — "moves are price, not mix", never "a chart of the index".
 *
 * ⚠️ NO `lowercase` CSS TRANSFORM. The voice is lowercase because the COPY is
 * written lowercase; forcing it in CSS would also flatten the tickers and rule
 * names that legitimately carry case — "V-MKT" would render "v-mkt" and "R3"
 * "r3", turning a real identifier into a typo.
 *
 * ⚠️ NEVER REPLACES AN HONESTY NOTE. Windows, coverage and basis stay exactly
 * where they were; this layer sits above them. A read-me line that absorbed
 * "last 30 complete days" would quietly drop the window from the page.
 */
export function ReadMe({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={`font-mono text-[11px] leading-snug text-ink-3 ${className ?? ""}`}>{children}</p>
  );
}

export function Section({
  title,
  readMe,
  subtitle,
  right,
  badge,
  flush,
  fill,
  className,
  children,
}: {
  title: ReactNode;
  /** How to read this surface — see <ReadMe>. Renders above `subtitle`, which
   *  keeps carrying the window / coverage / basis note. */
  readMe?: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned header slot — toggles, "see all →", a summary stat, etc. */
  right?: ReactNode;
  /** Small chip rendered before the title (e.g. the green "SALES" tag). */
  badge?: ReactNode;
  /** true → body has no padding (edge-to-edge tables); default padded. */
  flush?: boolean;
  /** true → the card becomes a flex column and the BODY grows to fill it. For a
   *  card that is stretched by a grid row (a side-by-side pair whose other half is
   *  taller): without this the body keeps its natural height and the extra space
   *  becomes a blank band under the content. Opt-in, because a table or a tile grid
   *  should NOT stretch — only a plot that can honestly use the height. */
  fill?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <SectionShell className={`${fill ? "flex h-full flex-col" : ""} ${className ?? ""}`}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            {badge}
            {/* Contrast, not size: the title competes with 18–40px numbers inside
                the module, so it earns weight + an explicit `text-ink` (it had no
                colour class and merely inherited). Deliberately NOT bigger — the
                Overview's density budget is tight (D1). */}
            <h2 className="text-[16px] font-bold leading-tight tracking-[-0.01em] text-ink">{title}</h2>
          </div>
          {readMe && <ReadMe className="mt-1.5">{readMe}</ReadMe>}
          {/* The honesty note keeps its own line, and keeps it BELOW the read-me:
              interpretation first, then the fine print it is qualified by. */}
          {subtitle && <div className="mt-1 text-[12px] text-ink-4">{subtitle}</div>}
        </div>
        {right && <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">{right}</div>}
      </header>
      <div
        className={`${flush ? "pb-1" : "px-4 pb-4 sm:px-5 sm:pb-5"} ${
          fill ? "flex min-h-0 flex-1 flex-col" : ""
        }`}
      >
        {children}
      </div>
    </SectionShell>
  );
}
