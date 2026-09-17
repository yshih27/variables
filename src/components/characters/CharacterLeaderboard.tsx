"use client";

import Link from "next/link";
import { Section } from "../Section";
import { TableFoot } from "../TableFoot";
import { useStoredPref } from "@/lib/windowPref";
import { characterHref } from "@/lib/card/character";
import type { CharacterLeaderboardRow } from "@/lib/data/characterRollups";
import { formatCompactUsd, formatInt } from "@/lib/format";
import { monthShort } from "@/lib/card/identityView";
import {
  CHARACTER_TOP_ROWS,
  CHARACTERS_OPEN_PREF,
  CHARACTERS_ROWS_PREF,
  charactersPrefKey,
  type CharactersOpenPref,
  type CharactersRowsPref,
} from "@/lib/card/characterView";

/**
 * The IP's characters, ranked by 30d resale volume — one row each, every row
 * a link to the character's page.
 *
 * The machines table's controls: the first CHARACTER_TOP_ROWS by default with
 * "Show all N →" in the foot, the card folds from its header, and both choices
 * persist per IP (`varible:characters:<ip>:rows|open`, read after mount).
 *
 * ⚠️ SHARES ARE PER CHARACTER AND NOT ADDITIVE. A card with two characters on
 * it counts under both, so the column does not sum to the IP — the foot says so.
 *
 * ⚠️ THE INDEX COLUMN IS THE PUBLISHED LEVEL OR "—". The leaderboard row
 * carries only the latest published point, so the month is named beside the
 * level and no month-over-month is derived here (that needs two points, which
 * the character page has and this row does not).
 */
export function CharacterLeaderboard({ rows, ip }: { rows: CharacterLeaderboardRow[]; ip: string }) {
  const [rowsPref, setRowsPref] = useStoredPref<CharactersRowsPref>(charactersPrefKey(ip, "rows"), CHARACTERS_ROWS_PREF, "top");
  const [openPref, setOpenPref] = useStoredPref<CharactersOpenPref>(charactersPrefKey(ip, "open"), CHARACTERS_OPEN_PREF, "open");
  const open = openPref === "open";
  const showAll = rowsPref === "all";
  const visible = showAll ? rows : rows.slice(0, CHARACTER_TOP_ROWS);
  const truncated = visible.length < rows.length;
  const withIndex = rows.filter((r) => r.indexLatest).length;

  return (
    <Section
      title="Characters"
      readMe={withIndex ? "who carries the resale, and whose index publishes" : "who carries the resale — no character index publishes yet"}
      subtitle={`Last 30 days · ${withIndex} of ${rows.length} characters clear the index floor`}
      disclosure={{ open, onToggle: () => setOpenPref(open ? "closed" : "open"), label: "Characters" }}
      flush
    >
      {open ? (
        <>
          <div className="scroll-x">
            <table className="w-full min-w-0 border-collapse text-left md:min-w-[860px]">
              <thead>
                <tr className="border-b border-line text-[10.5px] uppercase tracking-[0.07em] text-ink-4">
                  <th scope="col" className="py-2 pl-4 pr-3 font-medium sm:pl-5">#</th>
                  <th scope="col" className="px-3 py-2 font-medium">Character</th>
                  <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">Cards</th>
                  <th scope="col" className="hidden px-3 py-2 text-right font-medium lg:table-cell">Slabs</th>
                  <th scope="col" className="hidden px-3 py-2 text-right font-medium md:table-cell">30d sales</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">30d volume</th>
                  <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">Share of IP</th>
                  {/* A column of dashes is a broken-looking column: the index
                      column exists only once a character publishes one; until
                      then the read-me and the stat card carry the fact. */}
                  {withIndex > 0 && <th scope="col" className="py-2 pl-3 pr-4 text-right font-medium sm:pr-5">Index</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <tr key={r.key} className="border-b border-line/60 transition-colors last:border-0 hover:bg-bg-2">
                    <td className="py-2 pl-4 pr-3 tabular text-[11px] text-ink-4 sm:pl-5">{String(i + 1).padStart(2, "0")}</td>
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <Link href={characterHref(ip, r.key)} className="text-[12.5px] font-semibold text-ink hover:text-yellow">
                        {r.name}
                      </Link>
                    </th>
                    <td className="hidden px-3 py-2 text-right tabular text-[12.5px] text-ink-2 sm:table-cell">{formatInt(r.identities)}</td>
                    <td className="hidden px-3 py-2 text-right tabular text-[12.5px] text-ink-2 lg:table-cell">{formatInt(r.slabs)}</td>
                    <td className="hidden px-3 py-2 text-right tabular text-[12.5px] text-ink-2 md:table-cell">{formatInt(r.sales30d)}</td>
                    <td className="px-3 py-2 text-right tabular text-[12.5px] text-ink">{r.volume30d > 0 ? formatCompactUsd(r.volume30d) : <span className="text-ink-4">—</span>}</td>
                    <td className="hidden px-3 py-2 text-right tabular text-[12.5px] text-ink-2 sm:table-cell">{r.volume30d > 0 ? `${r.shareOfIp30d.toFixed(1)}%` : <span className="text-ink-4">—</span>}</td>
                    {withIndex > 0 && (
                    <td className="py-2 pl-3 pr-4 text-right tabular text-[12.5px] sm:pr-5">
                      {r.indexLatest ? (
                        <>
                          <span className="text-ink">{r.indexLatest.value.toFixed(1)}</span>
                          <span className="block font-mono text-[10px] text-ink-4">
                            {monthShort(r.indexLatest.ts)}
                            {r.indexLatest.thin ? " · thin" : ""}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-4" title="no published index — under 20 priced cards in two months running">—</span>
                      )}
                    </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TableFoot
            shown={visible.length}
            total={rows.length}
            noun="character"
            action={
              rows.length > CHARACTER_TOP_ROWS
                ? truncated
                  ? { label: `Show all ${rows.length} →`, onClick: () => setRowsPref("all") }
                  : { label: `Show top ${CHARACTER_TOP_ROWS}`, onClick: () => setRowsPref("top") }
                : undefined
            }
          />
          <p className="border-t border-line px-4 py-2 font-mono text-[10.5px] text-ink-4 sm:px-5">
            share = this character&apos;s 30d resale ÷ the IP&apos;s, same panel · a card with two characters counts under both, so shares do not sum to 100
          </p>
        </>
      ) : (
        <p className="border-t border-line px-4 py-2.5 font-mono text-[11px] text-ink-3 sm:px-5">
          <span className="tabular text-ink-2">{formatInt(rows.length)}</span> characters
          {" · "}
          <span className="tabular text-ink-2">{withIndex}</span> with a published index
          {rows[0] ? (
            <>
              {" · "}
              top <span className="text-ink-2">{rows[0].name}</span> at{" "}
              <span className="tabular text-ink-2">{rows[0].shareOfIp30d.toFixed(1)}%</span> of 30d resale
            </>
          ) : null}
        </p>
      )}
    </Section>
  );
}
