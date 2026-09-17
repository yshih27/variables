import Link from "next/link";
import { Section } from "../Section";
import type { CharacterSetRow } from "@/lib/data/characterRollups";
import { formatCompactUsd, formatInt } from "@/lib/format";

/**
 * By set — where this character's resale comes from, one row per set ranked
 * by 30d volume: the set (a link to its page), how many of the character's
 * cards sit in it, 30d sales, and 30d volume as a bar against the top set.
 *
 * ⚠️ "NO SET" IS A REAL ROW, NOT A GAP. A card whose set string was junk
 * still has a number and still sold; the reader files it under `setKey: null`.
 * It is shown, named as what it is and not linked, because dropping it would
 * hide its share of the character's volume from a split that claims to be one.
 *
 * Top TOP rows; the rest is one "+N more" line with their combined volume so
 * the card reads as the split it is. `fill` + a bottom-anchored note for §7.
 */
const TOP = 8;

export function CharacterBySet({ rows, ip }: { rows: CharacterSetRow[]; ip: string }) {
  const ranked = [...rows].sort((a, b) => b.volume30d - a.volume30d || b.sales30d - a.sales30d);
  const shown = ranked.slice(0, TOP);
  const rest = ranked.slice(TOP);
  const restVol = rest.reduce((a, r) => a + r.volume30d, 0);
  const restSales = rest.reduce((a, r) => a + r.sales30d, 0);
  const max = Math.max(1, ...shown.map((r) => r.volume30d));
  const total = ranked.reduce((a, r) => a + r.volume30d, 0);

  return (
    <Section title="By set" readMe="which sets this character's resale comes from" fill flush>
      <div className="flex min-h-0 flex-1 flex-col">
        {shown.length ? (
          <ul className="divide-y divide-line/60">
            {shown.map((r) => (
              <li key={r.setKey ?? "-"} className="px-4 py-2 sm:px-5">
                <div className="flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="min-w-0 truncate">
                    {r.setKey ? (
                      <Link href={`/ip/${ip}/sets/${r.setKey}`} className="text-ink transition-colors hover:text-yellow">
                        {r.setName ?? r.setKey}
                      </Link>
                    ) : (
                      <span className="font-mono text-[11.5px] text-ink-3">no set on the card</span>
                    )}
                    <span className="font-mono text-[10.5px] text-ink-4"> · {formatInt(r.identities)} card{r.identities === 1 ? "" : "s"}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-3">
                    <span className="tabular text-ink-2">{r.sales30d}</span> sale{r.sales30d === 1 ? "" : "s"} ·{" "}
                    <span className="tabular text-ink-2">{r.sales30d ? formatCompactUsd(r.volume30d) : "—"}</span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-none bg-bg-2">
                  <div className="h-full bg-yellow" style={{ width: `${(r.volume30d / max) * 100}%`, opacity: 0.85 }} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-2.5 font-mono text-[11px] text-ink-4 sm:px-5">no set has a sale of this character in the last 30 days</p>
        )}
        {rest.length > 0 && (
          <p className="px-4 py-2 font-mono text-[11px] text-ink-4 sm:px-5">
            +{formatInt(rest.length)} more set{rest.length === 1 ? "" : "s"} · {restSales} sale{restSales === 1 ? "" : "s"} · {restSales ? formatCompactUsd(restVol) : "—"}
          </p>
        )}
        <p className="mt-auto border-t border-line px-4 py-2.5 font-mono text-[10.5px] text-ink-4 sm:px-5">
          {total > 0 ? `30d resale by set · bars against the top set` : "sales and volume are the last 30 complete days"}
        </p>
      </div>
    </Section>
  );
}
