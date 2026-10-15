import type { ReactNode } from "react";

/**
 * The venue page as a story, in a fixed order: the platform, what it sells
 * (machines, boxes), who plays, what comes out (pulls), and the cards. Each
 * chapter is an anchored section; the nav lists only the chapters this venue
 * has, so a venue without machines never shows an empty "Machines".
 *
 * ⚠️ STICKS UNDER THE SHELL CHROME. The top bar and the ticker tape are sticky
 * themselves; `--shell-chrome-h` is their combined height (globals.css), with
 * the top bar alone as the fallback, as RailNav reads it.
 */
export type VenueChapter = { id: string; label: string };

export function VenueChapterNav({ chapters }: { chapters: VenueChapter[] }) {
  if (chapters.length < 2) return null;
  return (
    <nav
      aria-label="Chapters on this page"
      className="sticky top-[var(--shell-chrome-h,var(--shell-topbar-h))] z-20 -mx-8 border-b border-line/70 bg-bg/85 px-8 backdrop-blur-xl"
      data-venue-chapters
    >
      <ol className="scroll-x flex gap-5 py-2 font-mono text-[11.5px]">
        {chapters.map((c, i) => (
          <li key={c.id} className="shrink-0">
            <a href={`#${c.id}`} className="text-ink-3 hover:text-yellow">
              <span className="text-ink-4">{String(i + 1).padStart(2, "0")}</span> {c.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** `alone`: the venue's only chapter (a venue with nothing past its platform
 *  figures), so it carries no number or heading — there is no story to index. */
export function VenueChapterSection({ id, n, label, alone = false, children }: { id: string; n: number; label: string; alone?: boolean; children: ReactNode }) {
  if (alone) return <section id={id} className="space-y-3">{children}</section>;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-32 space-y-3 border-t border-line/70 pt-6 first:border-t-0 first:pt-0">
      <h2 id={`${id}-title`} className="flex items-baseline gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
        <span className="text-ink-4">{String(n).padStart(2, "0")}</span>
        {label}
      </h2>
      {children}
    </section>
  );
}
