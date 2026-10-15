import Link from "next/link";
import type { VenueStrip } from "@/lib/data/venueStrips";
import { Section } from "./Section";

/**
 * Against the other venues (buildVenueStrips): the four comparisons on
 * /platforms, one figure per venue, each on its own axis with this venue marked
 * and every venue listed with its figure. The venue page keeps its own story;
 * each full chart, with its windows and coverage, is one link away.
 *
 * ⚠️ NO WRITTEN CONCLUSION. Every measured venue is placed and printed; the
 * reader sees where this venue sits. A venue the full chart leaves unmeasured is
 * named as such, never placed at zero.
 */
const ROW_H = 22;
const DOT = "var(--color-yellow)";

/** A row's axis: a percentage from 0 to a round ceiling above its largest value,
 *  or dollars on a log axis between the powers of ten around its values. */
function axisFor(s: VenueStrip): { x: (v: number) => number; ticks: { v: number; label: string }[] } {
  const vals = s.points.map((p) => p.value);
  if (s.scale === "usd") {
    const lo = 10 ** Math.floor(Math.log10(Math.max(1, Math.min(...vals))));
    const hi = 10 ** Math.ceil(Math.log10(Math.max(lo * 10, ...vals)));
    const x = (v: number) => (100 * (Math.log10(Math.max(lo, v)) - Math.log10(lo))) / (Math.log10(hi) - Math.log10(lo));
    const ticks = [];
    for (let t = lo; t <= hi; t *= 10) ticks.push({ v: t, label: t >= 1000 ? `$${t / 1000}K` : `$${t}` });
    return { x, ticks };
  }
  const max = Math.max(...vals, 1);
  const step = max <= 10 ? 2 : max <= 50 ? 10 : 20;
  const hi = Math.min(100, Math.ceil(max / step) * step);
  return { x: (v: number) => (100 * Math.min(v, hi)) / hi, ticks: [0, hi / 2, hi].map((v) => ({ v, label: `${v}%` })) };
}

export function VenueCompareStrips({ strips, venue, names }: { strips: VenueStrip[]; venue: string; names: Record<string, string> }) {
  const shown = strips.filter((s) => s.points.length > 0);
  if (!shown.length) return null;
  const name = (k: string) => names[k] ?? k;

  return (
    <Section
      id="against-venues"
      className="scroll-mt-24 font-sans"
      title="Against the other venues"
      readMe="where this venue sits on each comparison: every measured venue on one axis per row"
      subtitle="Each row opens its full chart on Platforms"
      flush
    >
      <ul className="px-4 pb-1 pt-1 sm:px-5" data-venue-strips>
        {shown.map((s) => {
          const { x, ticks } = axisFor(s);
          const mine = s.points.find((p) => p.venue === venue);
          return (
            <li key={s.key} className="border-b border-line/60 py-3 last:border-b-0" data-strip={s.key}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 md:grid-cols-[220px_minmax(0,1fr)_170px]">
                <Link href={s.href} className="text-[13px] leading-snug text-ink hover:text-yellow md:truncate">
                  {s.title}
                </Link>
                <span className="text-right font-mono tabular md:order-last">
                  {mine ? (
                    <>
                      <span className="block text-[13px] font-semibold text-ink">{mine.text}</span>
                      {mine.window ? <span className="block text-[10.5px] text-ink-3">{mine.window}</span> : null}
                    </>
                  ) : (
                    <span className="text-[12px] text-ink-4">not measured</span>
                  )}
                </span>
                <div className="col-span-2 md:col-span-1">
                  <div className="relative" style={{ height: ROW_H }} role="img" aria-label={`${s.title}: ${s.points.map((p) => `${name(p.venue)} ${p.text}`).join(", ")}`}>
                    <span className="absolute inset-x-0 top-1/2 h-px bg-line" aria-hidden />
                    {ticks.map((t) => (
                      <span key={t.v} className="absolute inset-y-[5px] w-px bg-line/70" style={{ left: `${x(t.v)}%` }} aria-hidden />
                    ))}
                    {s.points
                      .slice()
                      .sort((a, b) => (a.venue === venue ? 1 : b.venue === venue ? -1 : 0))
                      .map((p) => {
                        const marked = p.venue === venue;
                        const d = marked ? 11 : 7;
                        return (
                          <span
                            key={p.venue}
                            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                            style={{
                              left: `${x(p.value)}%`,
                              width: d,
                              height: d,
                              background: marked ? DOT : "var(--color-ink-3)",
                              boxShadow: "0 0 0 2px var(--color-bg-1)",
                            }}
                            title={`${name(p.venue)} · ${p.text}${p.window ? ` · ${p.window}` : ""}`}
                          />
                        );
                      })}
                  </div>
                  <div className="relative mt-0.5 h-4 font-mono text-[10px] text-ink-4" aria-hidden>
                    {ticks.map((t, i) => (
                      <span
                        key={t.v}
                        className={`absolute top-0 whitespace-nowrap ${i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
                        style={{ left: `${x(t.v)}%` }}
                      >
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <p className="mt-1 font-mono text-[11px] leading-snug text-ink-3 md:pl-[236px]">
                {s.points.map((p, i) => (
                  <span key={p.venue}>
                    {i ? " · " : ""}
                    <span className={p.venue === venue ? "font-semibold text-ink" : ""}>{`${name(p.venue)} ${p.text}`}</span>
                  </span>
                ))}
                {s.unmeasured.length ? <span className="text-ink-4">{` · not measured: ${s.unmeasured.map(name).join(", ")}`}</span> : null}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] leading-snug text-ink-4 sm:px-5" data-venue-strips-receipt>
        {receipt(shown, name)}
      </p>
    </Section>
  );
}

/** The windows behind each row, from the rows themselves. */
function receipt(strips: VenueStrip[], name: (k: string) => string): string {
  const parts: string[] = [];
  for (const s of strips) {
    const windows = new Map<string, string[]>();
    for (const p of s.points) if (p.window) windows.set(p.window, [...(windows.get(p.window) ?? []), name(p.venue)]);
    const w = [...windows.entries()];
    const over = w.length === 1 ? w[0][0] : w.map(([win, vs]) => `${vs.join(", ")}: ${win}`).join("; ");
    if (s.key === "marketplace") parts.push(`marketplace share = resale on the venue's marketplace ÷ (resale + pack spend), complete days (${over})`);
    if (s.key === "packPrice") parts.push(`median pack price = the price at or under which half the venue's pack spend falls (${over})`);
    if (s.key === "top1") parts.push(`top 1% = the share of the venue's pack spend from its top 1% of wallets, since its records begin`);
    if (s.key === "returning") parts.push(`returning = players who pulled in an earlier month (${over})`);
  }
  return `${parts.join(" · ")} · each full chart on Platforms carries its window and coverage`;
}
