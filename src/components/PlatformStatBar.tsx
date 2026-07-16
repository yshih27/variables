import type { ReactNode } from "react";
import type { PlatformRow } from "@/lib/types";
import { totalActivity24, sharePct24, concentrationHHI24 } from "@/lib/platform/share";

/**
 * Platform structure ribbon for the /platforms overview — the twin of
 * CategoryStatBar on /ips, and the same bargain: breadth + concentration, the
 * questions the leaderboard below doesn't answer at a glance.
 *
 * These four stats live HERE rather than in the rail. The rail is now one row per
 * platform, so a "Top Platform" row and a "Platforms Tracked" row would be
 * aggregates squatting in a list of named things — and the leaderboard already
 * answers "who's on top" by being sorted. Shipping both would state the same fact
 * twice in one fold.
 */
function hhiLabel(hhi: number): string {
  // ⚠️ 0.25/0.4, NOT CategoryStatBar's 0.2/0.4: four platforms splitting the
  // market evenly is an HHI of exactly 0.25, so "Moderate" has to start there or
  // a perfectly even four-way market would read as concentrated.
  if (hhi >= 0.4) return "High";
  if (hhi >= 0.25) return "Moderate";
  return "Low";
}

export function PlatformStatBar({ rows }: { rows: PlatformRow[] }) {
  const total = totalActivity24(rows);
  const ranked = [...rows].sort(
    (a, b) => (b.total24Usd > 0 ? b.total24Usd : 0) - (a.total24Usd > 0 ? a.total24Usd : 0),
  );
  const top = ranked[0] ?? null;
  const topShare = top ? sharePct24(top, total) : null;
  const hhi = concentrationHHI24(rows, total);
  const chains = new Set(rows.map((p) => p.chain)).size;

  const items: { label: string; value: ReactNode }[] = [
    { label: "Platforms", value: <span className="tabular">{rows.length}</span> },
    { label: "Chains", value: <span className="tabular">{chains}</span> },
    {
      label: "Dominance",
      value:
        top && topShare != null ? (
          <span>
            {top.name}{" "}
            {/* 1dp, matching the table's Share column verbatim — the two sit in
                one fold, so "64%" over "64.0%" invites a double-take. */}
            <span className="tabular text-yellow">{topShare.toFixed(1)}%</span>
          </span>
        ) : (
          "—"
        ),
    },
    {
      label: "Concentration",
      value:
        hhi != null ? (
          <span>
            <span className="tabular">HHI {hhi.toFixed(2)}</span>{" "}
            <span className="text-ink-3">· {hhiLabel(hhi)}</span>
          </span>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <section className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line px-4 py-2 text-[12.5px]">
      {items.map((it, i) => (
        <div key={it.label} className="flex items-center gap-x-3">
          {i > 0 && <span aria-hidden className="text-ink-4">·</span>}
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-4">{it.label}</span>
            <span className="font-semibold text-ink-2">{it.value}</span>
          </span>
        </div>
      ))}
    </section>
  );
}
