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

export function Section({
  title,
  subtitle,
  right,
  badge,
  flush,
  className,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned header slot — toggles, "see all →", a summary stat, etc. */
  right?: ReactNode;
  /** Small chip rendered before the title (e.g. the green "SALES" tag). */
  badge?: ReactNode;
  /** true → body has no padding (edge-to-edge tables); default padded. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <SectionShell className={className}>
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
          {subtitle && <div className="mt-1 text-[12px] text-ink-3">{subtitle}</div>}
        </div>
        {right && <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">{right}</div>}
      </header>
      <div className={flush ? "pb-1" : "px-4 pb-4 sm:px-5 sm:pb-5"}>{children}</div>
    </SectionShell>
  );
}
