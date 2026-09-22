import Link from "next/link";
import { Section } from "../Section";
import { characterHref } from "@/lib/card/character";
import type { CharacterLeaderboardRow } from "@/lib/data/characterRollups";
import { formatCompactUsd } from "@/lib/format";

/**
 * The IP overview's "Top characters (30d)" — five rows from the character
 * leaderboard, each a link to its character page, and "Characters →" to the
 * full board. Sits in the row the set and grade panels share, in the same
 * frame and type; renders nothing for an IP with no character on the board.
 */
export function TopCharacters({
  rows,
  ip,
}: {
  rows: CharacterLeaderboardRow[];
  ip: string;
}) {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.volume30d));
  return (
    <Section
      title="Top characters"
      readMe="who carries the resale, by character"
      subtitle={
        <>
          last 30 days · share of the IP&apos;s resale
          {" · "}
          <Link
            href={`/ip/${ip}/characters`}
            className="text-ink-3 transition-colors hover:text-yellow"
          >
            Characters →
          </Link>
        </>
      }
      className="font-sans"
      // `fill`: the card is a grid cell beside the set and grade panels — its
      // frame must reach the row's bottom edge (§7), the note anchored there.
      fill
      flush
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <ul className="divide-y divide-line/60">
          {rows.map((r, i) => (
            <li key={r.key} className="px-4 py-2 sm:px-5">
              <div className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="tabular font-mono text-[11px] text-ink-4">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Link
                    href={characterHref(ip, r.key)}
                    className="truncate font-semibold text-ink transition-colors hover:text-yellow"
                  >
                    {r.name}
                  </Link>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-ink-3">
                  <span className="tabular text-ink-2">
                    {formatCompactUsd(r.volume30d)}
                  </span>{" "}
                  ·{" "}
                  <span className="tabular text-ink-2">
                    {r.shareOfIp30d.toFixed(1)}%
                  </span>
                </span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-none bg-bg-2">
                <div
                  className="h-full bg-yellow"
                  style={{
                    width: `${(r.volume30d / max) * 100}%`,
                    opacity: 0.85,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-auto border-t border-line px-4 py-2 font-mono text-[10.5px] text-ink-4 sm:px-5">
          shares are per character, not additive
        </p>
      </div>
    </Section>
  );
}
