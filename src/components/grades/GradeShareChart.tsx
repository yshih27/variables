import { Section } from "../Section";
import type { ShareDay } from "@/lib/data/gradeSetPanel";

/**
 * Grade share of resale volume, day by day, as a 100% stack.
 *
 * A DIFFERENT QUESTION from the index levels beside it (terminal-ux-study §3):
 * that one asks "what is a grade worth", this one asks "what is the market
 * buying". They may share a row.
 *
 * ⚠️ A DAY WITH NO VOLUME IS ABSENT FROM THE AXIS, not a gap in the stack. The
 * projection drops empty days entirely (gradeShareDaily), so the columns here are
 * days that actually traded — a stack of zeros would read as "every grade went
 * quiet" rather than "nothing cleared".
 *
 * ⚠️ THE SHARES ARE OF THAT DAY, NOT OF THE WINDOW. A thin day's 100% is one
 * sale's grade taking the whole column, which is honest and looks dramatic; the
 * column width is constant, so the eye is not told the day was big.
 */
const PLOT_H = 180;
const VIEW_W = 1000;

export function GradeShareChart({
  days,
  grades,
  colors,
}: {
  days: ShareDay[];
  /** Grades in stacking order — the table's own order, biggest first. */
  grades: string[];
  colors: Record<string, string>;
}) {
  if (days.length < 2) {
    return (
      <Section title="Grade share over time" readMe="what the market is buying, day by day" fill>
        <p className="text-[12.5px] text-ink-3">Not enough days with resale volume to draw a share.</p>
      </Section>
    );
  }

  const stack = [...grades, "Other"];
  const w = VIEW_W / days.length;

  return (
    <Section
      title="Grade share over time"
      readMe="what the market is buying, day by day"
      subtitle={`Share of daily resale volume · ${days.length} days with volume`}
      fill
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap gap-x-3 gap-y-1 pb-2 text-[11px]">
          {stack.map((g) => (
            <span key={g} className="inline-flex items-center gap-1.5 text-ink-3">
              <span aria-hidden className="h-2 w-2" style={{ background: colors[g] ?? "var(--color-line-2)" }} />
              {g}
            </span>
          ))}
        </div>

        <svg
          viewBox={`0 0 ${VIEW_W} ${PLOT_H}`}
          preserveAspectRatio="none"
          className="h-[180px] w-full"
          role="img"
          aria-label={`Grade share of daily resale volume over ${days.length} days`}
        >
          {days.map((d, i) => {
            let acc = 0;
            return (
              <g key={d.ts}>
                {stack.map((g) => {
                  const v = d.byGrade[g] ?? 0;
                  if (!(v > 0)) return null;
                  const h = (v / d.total) * PLOT_H;
                  const y = PLOT_H - acc - h;
                  acc += h;
                  return (
                    <rect
                      key={g}
                      x={i * w}
                      y={y}
                      width={Math.max(w - 0.5, 0.5)}
                      height={h}
                      fill={colors[g] ?? "var(--color-line-2)"}
                    >
                      <title>{`${d.ts.slice(0, 10)} · ${g}: ${((v / d.total) * 100).toFixed(0)}%`}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
        </svg>

        <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-ink-4">
          <span>{days[0].ts.slice(0, 10)}</span>
          <span className="text-ink-3">each column = one day&apos;s volume, split by grade</span>
          <span>{days[days.length - 1].ts.slice(0, 10)}</span>
        </div>
      </div>
    </Section>
  );
}
