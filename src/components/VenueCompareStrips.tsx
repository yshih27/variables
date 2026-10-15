import Link from "next/link";
import type { StripPoint, VenueStrip } from "@/lib/data/venueStrips";
import { Section } from "./Section";

/**
 * Against the other venues (buildVenueStrips): four small bar charts, one per
 * comparison on /platforms. Every measured venue is a labelled bar with its
 * figure, this venue's bar in lime; hover (or focus) a bar for the figure in a
 * sentence and its window. Each chart's title opens its full chart.
 *
 * ⚠️ NO WRITTEN CONCLUSION. The bars and their figures are the whole read. A
 * venue the full chart leaves unmeasured is not drawn, and the footnote says so;
 * windows and coverage sit in each bar's hover and on the full chart.
 *
 * Bars run from zero to the chart's largest figure, linear, so a bar twice as
 * long is a figure twice as large. Hover reads are CSS (group-hover / focus),
 * no client script, so the section stays a server component.
 */
export function VenueCompareStrips({ strips, venue, names }: { strips: VenueStrip[]; venue: string; names: Record<string, string> }) {
  const shown = strips.filter((s) => s.points.length > 0);
  if (!shown.length) return null;
  const name = (k: string) => names[k] ?? k;

  return (
    <Section
      id="against-venues"
      className="scroll-mt-24 font-sans"
      title="Against the other venues"
      readMe={`${name(venue)} beside every venue we can measure, on four comparisons`}
      right={
        <Link href="/platforms" className="text-[12px] text-ink-3 transition-colors hover:text-yellow">
          Full charts on Platforms →
        </Link>
      }
    >
      <div className="grid grid-cols-1 gap-x-10 gap-y-7 md:grid-cols-2" data-venue-strips>
        {shown.map((s) => (
          <MiniBars key={s.key} strip={s} venue={venue} name={name} />
        ))}
      </div>
      <p className="mt-5 font-mono text-[10.5px] leading-snug text-ink-4" data-venue-strips-receipt>
        a venue missing from a chart is not measured on it · hover or tap a bar for its figure in full
      </p>
    </Section>
  );
}

function MiniBars({ strip, venue, name }: { strip: VenueStrip; venue: string; name: (k: string) => string }) {
  const max = Math.max(...strip.points.map((p) => p.value), 1e-9);
  return (
    <figure className="m-0" data-strip={strip.key}>
      <figcaption className="mb-2.5 flex items-baseline justify-between gap-3">
        <Link href={strip.href} className="text-[13px] font-medium text-ink transition-colors hover:text-yellow">
          {strip.title}
        </Link>
        {strip.window ? <span className="shrink-0 font-mono text-[10.5px] text-ink-4">{strip.window}</span> : null}
      </figcaption>
      <div className="space-y-1.5">
        {strip.points.map((p) => (
          <Bar key={p.venue} point={p} marked={p.venue === venue} label={name(p.venue)} widthPct={(100 * p.value) / max} />
        ))}
      </div>
    </figure>
  );
}

function Bar({ point, marked, label, widthPct }: { point: StripPoint; marked: boolean; label: string; widthPct: number }) {
  const sentence = `${label}: ${point.detail}`;
  return (
    <div
      tabIndex={0}
      role="img"
      aria-label={sentence}
      className="group relative grid grid-cols-[110px_minmax(0,1fr)_56px] items-center gap-2.5 outline-none focus-visible:ring-1 focus-visible:ring-yellow/60"
    >
      <span className={`truncate text-[12px] ${marked ? "font-semibold text-ink" : "text-ink-3"}`}>{label}</span>
      <span className="h-2.5 bg-bg-3">
        <span
          className="block h-full transition-opacity group-hover:opacity-80"
          style={{ width: `${Math.max(1.5, widthPct)}%`, background: marked ? "var(--color-yellow)" : "var(--color-ink-3)" }}
        />
      </span>
      <span className={`text-right font-mono text-[12px] tabular ${marked ? "font-semibold text-ink" : "text-ink-3"}`}>{point.text}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-[120px] z-20 mb-1.5 hidden w-max max-w-[320px] border border-line bg-bg-2 px-2.5 py-1.5 text-[11.5px] leading-snug text-ink-2 shadow-lg group-hover:block group-focus:block"
      >
        <span className="font-semibold text-ink">{label}</span>: {point.detail}
      </span>
    </div>
  );
}
