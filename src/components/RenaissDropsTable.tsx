import { DROP_MAX_SPAN_MS, DROP_MIN_PACKS, DROP_SETTLE_MS, OPEN_BURST_MS, OPEN_BURST_PACKS, type DropRow, type RenaissDrops } from "@/lib/renaiss/drops";
import { formatMonthDayUtc } from "@/lib/format";
import { dropLabel } from "@/lib/renaiss/dropNames";
import { Section } from "./Section";

/**
 * Renaiss's limited drops (`renaiss-drops`): who buys them, and how much each
 * kind of buyer takes.
 *
 * Every buyer falls in one group: returning (bought an earlier drop), first
 * drop (played Renaiss before, never bought a drop), or new to Renaiss (first
 * Renaiss pull of all was this drop). Tiles on top give each group's share of
 * the newest drops' buyers and packs, and the median sell-out. Below, one row
 * per drop, newest first (the newest RECENT shown, the rest behind a toggle).
 * Each group's cell carries two bars on one 0–100% scale, its share of the
 * buyers and its share of the packs, each labelled. Comparing the two is the
 * read. Hover (or focus) a row for its counts.
 *
 * ⚠️ INFERRED, AND SAYS SO. Renaiss publishes no drop calendar or supply; the
 * receipt line states the rule (src/lib/renaiss/drops.ts), where the clock
 * starts, and how far back "an earlier drop" can reach.
 *
 * ⚠️ SERVER-ONLY, AND NOT RENDERED: topBuyersSharePct, buyerPacks and
 * buyerWallets. How concentrated a drop's buying is stays private to Renaiss
 * (owner's call, Oct 14 2026), and a client component would ship the whole
 * snapshot in the page's RSC payload. Keep this a server component: the hover
 * reads are CSS and the toggle is a native <details>.
 *
 * No written conclusion: the shares, the bars and the counts are the read.
 */

/** Rows shown before the toggle, and the window the tiles summarise. */
const RECENT = 6;

const GROUPS = [
  { key: "returning", label: "Returning", short: "Returning", long: "Returning (bought an earlier drop)" },
  { key: "played", label: "First drop", short: "First drop", long: "First drop (played Renaiss before)" },
  { key: "new", label: "New to Renaiss", short: "New", long: "New to Renaiss" },
] as const;
type GroupKey = (typeof GROUPS)[number]["key"];

/** Room kept at a share bar's end for its value ("100%" plus the gap), so a full bar's label stays in its cell. */
const LABEL_ROOM = "2.75rem";
/** The two shares in every group cell: buyers in a neutral, packs in the accent. */
const BUYERS_BAR = "var(--color-ink-3)";
const PACKS_BAR = "var(--color-yellow)";

/** Where a drop's clock starts and its date comes from: the opening (drops.ts openingOf), else its first pull on an older row. */
const openOf = (d: DropRow) => d.openAt ?? d.firstAt;
/** The feed's name, else Varible's (dropNames.ts), else "Drop". */
const nameOf = (d: DropRow) => dropLabel(d)?.name ?? "Drop";
/** "A, B and C". */
/** "35m", "3h 25m" (a no-break space keeps it on one line). */
const duration = (ms: number): string => {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h\u00a0${String(mins % 60).padStart(2, "0")}m` : `${mins}m`;
};
const hours = (ms: number) => `${Math.round(ms / 3_600_000)} hours`;
const int = (n: number) => n.toLocaleString("en-US");
const share = (n: number, of: number) => (of > 0 ? (100 * n) / of : null);
/** "26%"; a share above zero that rounds to 0 reads "<1%", so a few packs never print as none. */
const pctText = (x: number | null) => (x == null ? "—" : x > 0 && x < 0.5 ? "<1%" : `${Math.round(x)}%`);
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type Group = { buyers: number; packs: number | null; buyersPct: number | null; packsPct: number | null };
type DropView = {
  d: DropRow;
  name: string;
  date: string;
  openUtc: string;
  soldMs: number;
  halfMs: number | null;
  groups: Record<GroupKey, Group>;
};

function viewOf(d: DropRow): DropView {
  const open = Date.parse(openOf(d));
  const split = d.packsNew != null && d.packsReturning != null;
  const buyers = { returning: d.returningBuyers, new: d.newPlayers, played: Math.max(0, d.buyers - d.returningBuyers - d.newPlayers) };
  const packs = split ? { returning: d.packsReturning!, new: d.packsNew!, played: Math.max(0, d.packs - d.packsReturning! - d.packsNew!) } : null;
  const group = (k: GroupKey): Group => ({
    buyers: buyers[k],
    packs: packs ? packs[k] : null,
    buyersPct: share(buyers[k], d.buyers),
    packsPct: packs ? share(packs[k], d.packs) : null,
  });
  return {
    d,
    name: nameOf(d),
    date: formatMonthDayUtc(openOf(d)) ?? "",
    openUtc: openOf(d).slice(11, 16),
    soldMs: Math.max(0, Date.parse(d.lastAt) - open),
    halfMs: d.halfAt ? Math.max(0, Date.parse(d.halfAt) - open) : null,
    groups: { returning: group("returning"), played: group("played"), new: group("new") },
  };
}

/** Columns from md: drop · the three groups · sold out · buyers · packs. */
const COLS = "md:grid-cols-[minmax(140px,1.1fr)_repeat(3,minmax(104px,1fr))_minmax(130px,1fr)_56px_56px]";

export function RenaissDropsTable({ snap }: { snap: RenaissDrops | null | undefined }) {
  if (!snap?.drops?.length) return null;
  const views = snap.drops.map(viewOf);
  const recent = views.slice(0, RECENT);
  const older = views.slice(RECENT);
  const oldest = snap.drops[snap.drops.length - 1];
  const maxSold = Math.max(1, ...views.map((v) => v.soldMs));
  // Where the names come from, said in the receipt line: the feed, else a posted name Varible added.
  const posted = snap.drops.filter((d) => dropLabel(d)?.source === "varible").length;
  const unnamed = snap.drops.some((d) => !dropLabel(d));

  // The tiles: each group's share of the newest drops' buyers and packs, pooled.
  const split = recent.filter((v) => v.groups.returning.packs != null);
  const pooled = (k: GroupKey) => ({
    buyers: share(recent.reduce((s, v) => s + v.groups[k].buyers, 0), recent.reduce((s, v) => s + v.d.buyers, 0)),
    packs: split.length ? share(split.reduce((s, v) => s + (v.groups[k].packs ?? 0), 0), split.reduce((s, v) => s + v.d.packs, 0)) : null,
  });
  const soldMedian = median(recent.map((v) => v.soldMs));
  const soldFastest = recent.length ? Math.min(...recent.map((v) => v.soldMs)) : null;

  return (
    <Section
      id="drops"
      className="scroll-mt-24 font-sans"
      title="Limited drops"
      readMe="one-time packs that sold their whole run within a day: who buys them, and how much each kind of buyer takes"
      subtitle={`${snap.drops.length} drops since ${formatMonthDayUtc(openOf(oldest))}`}
      flush
    >
      {/* Tiles: the newest drops at a glance. */}
      <div className="px-4 pb-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3 sm:px-5">{`Newest ${recent.length} drops`}</div>
      <div className="grid grid-cols-2 gap-px border-y border-line bg-line md:grid-cols-4" data-drops-tiles>
        {GROUPS.map((g) => {
          const p = pooled(g.key);
          return (
            <Tile key={g.key} label={g.long}>
              <Figure color={BUYERS_BAR} value={pctText(p.buyers)} unit="of buyers" />
              <Figure color={PACKS_BAR} value={pctText(p.packs)} unit="of packs" />
            </Tile>
          );
        })}
        <Tile label="Sold out in">
          <Figure value={soldMedian == null ? "—" : duration(soldMedian)} unit="median" />
          <Figure value={soldFastest == null ? "—" : duration(soldFastest)} unit="fastest" />
        </Tile>
      </div>

      {/* Legend and column heads. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 pb-2 pt-3 text-[11.5px] text-ink-2 sm:px-5" data-drops-legend>
        <span className="text-ink-3">Each group&apos;s share of the drop&apos;s</span>
        <Key color={BUYERS_BAR} label="buyers" />
        <Key color={PACKS_BAR} label="packs" />
        <span className="flex items-center gap-1.5 md:ml-auto">
          <span className="relative block h-1.5 w-6 bg-ink-3" aria-hidden>
            <span className="absolute -bottom-[3px] -top-[3px] left-[35%] w-[2px] bg-ink" />
          </span>
          Sold out in, ticked where half the run was gone
        </span>
      </div>
      <div className={`hidden border-y border-line px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3 sm:px-5 md:grid md:gap-x-6 ${COLS}`} aria-hidden>
        <span>Drop</span>
        {GROUPS.map((g) => (
          <span key={g.key}>{g.label}</span>
        ))}
        <span>Sold out in</span>
        <span className="text-right">Buyers</span>
        <span className="text-right">Packs</span>
      </div>

      <ol data-drops-rows>
        {recent.map((v, i) => (
          <DropRowView key={v.d.productId} v={v} maxSold={maxSold} opensUp={i >= recent.length / 2} />
        ))}
      </ol>
      {older.length ? (
        <details className="group/more border-t border-line">
          <summary className="cursor-pointer list-none px-4 py-2.5 font-mono text-[10.5px] text-ink-3 transition-colors hover:text-yellow group-open/more:text-ink-2 sm:px-5 [&::-webkit-details-marker]:hidden">
            <span className="group-open/more:hidden">{`Show all ${views.length} drops ▾`}</span>
            <span className="hidden group-open/more:inline">{`Show the newest ${recent.length} ▴`}</span>
          </summary>
          <ol className="border-t border-line" data-drops-rows-older>
            {older.map((v, i) => (
              <DropRowView key={v.d.productId} v={v} maxSold={maxSold} opensUp={i >= older.length / 2} />
            ))}
          </ol>
        </details>
      ) : null}
      <p className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] leading-snug text-ink-4 sm:px-5" data-drops-receipt>
        {`a drop is a pack whose ${DROP_MIN_PACKS}+ paid pulls all came within ${hours(DROP_MAX_SPAN_MS)} of its first, listed once ${hours(DROP_SETTLE_MS)} pass with no sale: inferred from the pulls, Renaiss publishes no supply · buyers are wallets · returning = bought an earlier drop, counted from ${formatMonthDayUtc(snap.historyFrom)} · first drop = had played Renaiss, never bought a drop · new to Renaiss = their first Renaiss pull was in that drop · tiles pool the newest ${recent.length} drops · sold out in = from the opening, the first of ${OPEN_BURST_PACKS} packs bought within ${OPEN_BURST_MS / 60_000} minutes (so a pack bought early doesn't start the clock), to the run's last pack · names: Renaiss's feed${posted ? `, or for the ${posted} drops it leaves unnamed, Renaiss's announcement posts on X (added by Varible)` : ""}${unnamed ? ` · "Drop" = no name known` : ""}`}
      </p>
    </Section>
  );
}

/** A tile: its figures first, then what they are (value above label, as StatCard). */
function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-1 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">{children}</div>
      <div className="mt-1.5 text-[12px] text-ink-2">{label}</div>
    </div>
  );
}

/** One figure in a tile; the key mark ties it to the bars below. */
function Figure({ value, unit, color }: { value: string; unit: string; color?: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      {color ? <span className="h-2 w-2 shrink-0 self-center" style={{ background: color }} aria-hidden /> : null}
      <span className="font-mono text-[22px] font-semibold leading-none tabular text-ink">{value}</span>
      <span className="font-mono text-[11px] text-ink-3">{unit}</span>
    </span>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-4 shrink-0" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

/**
 * One share as a bar on a 0–100% scale (the cell's width less the label's room),
 * its value at the bar's tip. The value used to sit at the cell's right edge,
 * as near the next column's bars as its own; at the tip there is one reading.
 */
function ShareBar({ pct, color, strong }: { pct: number | null; color: string; strong?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="block h-[7px] min-w-[2px] shrink-0" style={{ width: `calc((100% - ${LABEL_ROOM}) * ${(pct ?? 0) / 100})`, background: color }} aria-hidden />
      <span className={`font-mono text-[11.5px] leading-none tabular ${strong ? "text-ink" : "text-ink-2"}`}>{pctText(pct)}</span>
    </span>
  );
}

/**
 * One drop. From md one grid row: name, the three groups' share bars, the
 * sell-out bar, buyers and packs; the counts open on hover or focus, upward in
 * the lower half of a list so they stay inside the card. Below md it stacks.
 */
function DropRowView({ v, maxSold, opensUp }: { v: DropView; maxSold: number; opensUp: boolean }) {
  const { d } = v;
  const sentence = `${v.name}, ${v.date}: ${int(d.packs)} packs to ${int(d.buyers)} buyers, sold out in ${duration(v.soldMs)}${v.halfMs != null ? `, half gone in ${duration(v.halfMs)}` : ""}; ${GROUPS.map(
    (g) => `${g.long}: ${pctText(v.groups[g.key].buyersPct)} of buyers, ${pctText(v.groups[g.key].packsPct)} of packs`,
  ).join("; ")}`;
  return (
    <li
      tabIndex={0}
      aria-label={sentence}
      className={`group relative grid grid-cols-3 items-center gap-x-4 gap-y-2 border-b border-line/60 px-4 py-3 outline-none transition-colors last:border-b-0 hover:bg-bg-2/60 focus-visible:bg-bg-2/60 sm:px-5 md:gap-x-6 md:gap-y-0 md:py-2.5 ${COLS}`}
    >
      <span className="col-span-2 min-w-0 truncate md:col-span-1">
        <span className="text-[13px] font-semibold text-ink">{v.name}</span>
        <span className="ml-2 font-mono text-[11px] tabular text-ink-3">{v.date}</span>
      </span>
      <span className="text-right font-mono text-[12px] font-semibold tabular text-ink md:hidden">{duration(v.soldMs)}</span>

      {GROUPS.map((g) => {
        const grp = v.groups[g.key];
        return (
          <span key={g.key} className="min-w-0">
            <span className="mb-1 block truncate font-mono text-[10px] uppercase tracking-[0.05em] text-ink-3 md:hidden">{g.short}</span>
            <span className="flex flex-col gap-1">
              <ShareBar pct={grp.buyersPct} color={BUYERS_BAR} />
              <ShareBar pct={grp.packsPct} color={PACKS_BAR} strong />
            </span>
          </span>
        );
      })}

      {/* Sold out in, on one time scale for every drop; the tick marks half the run gone. */}
      <span className="hidden items-center gap-2 md:flex">
        <span className="relative block h-1.5 min-w-[2px] bg-ink-3" style={{ width: `calc((100% - 4.25rem) * ${v.soldMs / maxSold})` }} aria-hidden>
          {v.halfMs != null && v.soldMs > 0 ? (
            <span className="absolute -bottom-[3px] -top-[3px] w-[2px] bg-ink" style={{ left: `min(calc(100% - 2px), ${(100 * v.halfMs) / v.soldMs}%)` }} />
          ) : null}
        </span>
        <span className="font-mono text-[12px] font-semibold tabular text-ink">{duration(v.soldMs)}</span>
      </span>
      <span className="hidden text-right font-mono text-[12.5px] tabular text-ink-2 md:block">{int(d.buyers)}</span>
      <span className="hidden text-right font-mono text-[12.5px] tabular text-ink-2 md:block">{int(d.packs)}</span>
      <span className="col-span-3 font-mono text-[11px] tabular text-ink-3 md:hidden">{`${int(d.buyers)} buyers · ${int(d.packs)} packs`}</span>

      {/* The counts behind the shares: values lead, labels follow. */}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-4 z-20 hidden w-max max-w-[480px] border border-line bg-bg-2 px-3 py-2 text-[11.5px] leading-snug text-ink-2 shadow-lg sm:left-5 md:left-[calc(18%+1rem)] md:group-hover:block md:group-focus-visible:block ${opensUp ? "bottom-full mb-1" : "top-full mt-1"}`}
      >
        <span className="block font-semibold text-ink">{`${v.name} · ${v.date} · opened ${v.openUtc} UTC`}</span>
        <span className="mt-0.5 block whitespace-nowrap font-mono tabular">
          {`${int(d.packs)} packs to ${int(d.buyers)} buyers · sold out in ${duration(v.soldMs)}${v.halfMs != null ? ` · half gone in ${duration(v.halfMs)}` : ""}`}
        </span>
        <span className="mt-1.5 grid grid-cols-[auto_auto_auto] items-center gap-x-3 gap-y-1">
          {GROUPS.map((g) => {
            const grp = v.groups[g.key];
            return (
              <span key={g.key} className="contents">
                <span className="whitespace-nowrap text-ink-3">{g.long}</span>
                <span className="whitespace-nowrap font-mono tabular">
                  <span className="text-ink">{int(grp.buyers)}</span>
                  {` buyers · ${pctText(grp.buyersPct)}`}
                </span>
                <span className="whitespace-nowrap font-mono tabular">
                  {grp.packs == null ? "—" : (
                    <>
                      <span className="text-ink">{int(grp.packs)}</span>
                      {` packs · ${pctText(grp.packsPct)}`}
                    </>
                  )}
                </span>
              </span>
            );
          })}
        </span>
      </span>
    </li>
  );
}
