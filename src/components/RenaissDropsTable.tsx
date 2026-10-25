import { DROP_MAX_SPAN_MS, DROP_MIN_PACKS, DROP_SETTLE_MS, OPEN_BURST_MS, OPEN_BURST_PACKS, type DropRow, type RenaissDrops } from "@/lib/renaiss/drops";
import { formatMonthDayUtc } from "@/lib/format";
import { dropLabel } from "@/lib/renaiss/dropNames";
import { Section } from "./Section";

/**
 * Renaiss's limited drops (`renaiss-drops`), one row per drop, newest first.
 * Each row reads across: the drop's packs as one bar split by who bought them,
 * how long it took to sell out (with the moment half the run was gone), its
 * buyers, and packs per buyer for everyone, for buyers of an earlier drop and
 * for first-drop buyers. Hover (or focus) a row for its full breakdown; the
 * table view under the toggle holds every figure.
 *
 * Two bars, two scales, side by side: packs on one, time on the other, never
 * one bar carrying both. Bar lengths compare across rows (the biggest run and
 * the slowest sell-out fill their tracks).
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
 * No written conclusion: the bars, the figures and the breakdown are the read.
 */

/**
 * Buyer groups, longest tie to Renaiss's drops first: one lime ramp from the
 * site's tokens, validated as an ordinal ramp on the card surface (Oct 25
 * 2026: monotone lightness, steps ≥ 0.06 apart, darkest step 2.8:1).
 */
const GROUPS = [
  { key: "returning", label: "Bought an earlier drop", color: "var(--color-lime-dim)" },
  { key: "played", label: "First drop, played before", color: "var(--color-yellow)" },
  { key: "new", label: "First drop, new to Renaiss", color: "var(--color-yellow-2)" },
] as const;
type GroupKey = (typeof GROUPS)[number]["key"];

/** Where a drop's clock starts and its date comes from: the opening (drops.ts openingOf), else its first pull on an older row. */
const openOf = (d: DropRow) => d.openAt ?? d.firstAt;
/** The feed's name, else Varible's (dropNames.ts), else "Drop". */
const nameOf = (d: DropRow) => dropLabel(d)?.name ?? "Drop";
/** "A, B and C". */
const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** "35m", "3h 25m" (a no-break space keeps it on one line). */
const duration = (ms: number): string => {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h\u00a0${String(mins % 60).padStart(2, "0")}m` : `${mins}m`;
};
const hours = (ms: number) => `${Math.round(ms / 3_600_000)} hours`;
const int = (n: number) => n.toLocaleString("en-US");
const perBuyer = (packs: number | null, buyers: number) => (packs == null || buyers <= 0 ? null : packs / buyers);
const oneDp = (n: number | null) => (n == null ? "—" : n.toFixed(1));

type DropView = {
  d: DropRow;
  name: string;
  date: string;
  openUtc: string;
  soldMs: number;
  halfMs: number | null;
  buyers: Record<GroupKey, number>;
  /** Null until the row carries its packs per buyer (the warmer fills older rows once). */
  packs: Record<GroupKey, number> | null;
  per: { all: number | null; returning: number | null; firstDrop: number | null };
};

function viewOf(d: DropRow): DropView {
  const open = Date.parse(openOf(d));
  const split = d.packsNew != null && d.packsReturning != null;
  const buyers = { returning: d.returningBuyers, new: d.newPlayers, played: Math.max(0, d.buyers - d.returningBuyers - d.newPlayers) };
  const packs = split ? { returning: d.packsReturning!, new: d.packsNew!, played: Math.max(0, d.packs - d.packsReturning! - d.packsNew!) } : null;
  return {
    d,
    name: nameOf(d),
    date: formatMonthDayUtc(openOf(d)) ?? "",
    openUtc: openOf(d).slice(11, 16),
    soldMs: Math.max(0, Date.parse(d.lastAt) - open),
    halfMs: d.halfAt ? Math.max(0, Date.parse(d.halfAt) - open) : null,
    buyers,
    packs,
    per: {
      all: perBuyer(d.packs, d.buyers),
      returning: packs ? perBuyer(packs.returning, buyers.returning) : null,
      firstDrop: packs ? perBuyer(packs.played + packs.new, buyers.played + buyers.new) : null,
    },
  };
}

/** Columns: drop · packs · sold out · buyers · packs per buyer (all; and, from lg, the two groups). */
const COLS = "md:grid-cols-[minmax(150px,1.1fr)_minmax(200px,2.4fr)_minmax(150px,1.5fr)_60px_56px] lg:grid-cols-[minmax(150px,1.1fr)_minmax(200px,2.4fr)_minmax(150px,1.5fr)_60px_56px_76px_68px]";

export function RenaissDropsTable({ snap }: { snap: RenaissDrops | null | undefined }) {
  if (!snap?.drops?.length) return null;
  const views = snap.drops.map(viewOf);
  const oldest = snap.drops[snap.drops.length - 1];
  const maxPacks = Math.max(...views.map((v) => v.d.packs));
  const maxSold = Math.max(1, ...views.map((v) => v.soldMs));
  // Names Varible added where the feed has none, oldest first, said in the receipt line.
  const ours = [...snap.drops].reverse().flatMap((d) => {
    const l = dropLabel(d);
    return l?.source === "varible" ? [l.name.replace(/ Pack$/, "")] : [];
  });

  return (
    <Section
      id="drops"
      className="scroll-mt-24 font-sans"
      title="Limited drops"
      readMe="one-time packs that sold their whole run within a day: how fast, and who bought"
      subtitle={`${snap.drops.length} drops since ${formatMonthDayUtc(openOf(oldest))}`}
      flush
    >
      {/* Legend: the three buyer groups, and the half-run tick on the time bar. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 pb-3 pt-1 text-[11.5px] sm:px-5" data-drops-legend>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="text-ink-3">Packs, by who bought them</span>
          {GROUPS.map((g) => (
            <span key={g.key} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0" style={{ background: g.color }} aria-hidden />
              <span className="text-ink-2">{g.label}</span>
            </span>
          ))}
        </span>
        <span className="flex items-center gap-1.5 text-ink-2">
          <span className="relative block h-1.5 w-6 bg-ink-3" aria-hidden>
            <span className="absolute -bottom-[3px] -top-[3px] left-[35%] w-[2px] bg-ink" />
          </span>
          Sold out in, ticked where half the run was gone
        </span>
      </div>

      {/* Column heads, from md: "Packs each" spans its three columns (one from md, three from lg). */}
      <div className={`hidden items-end border-y border-line px-4 pb-2 pt-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3 sm:px-5 md:grid md:gap-x-4 md:gap-y-1 ${COLS}`} aria-hidden>
        <span className="col-start-5 col-end-6 border-b border-line/80 pb-1 text-right lg:col-end-8">Packs each</span>
        <span className="col-start-1 row-start-2">Drop</span>
        <span className="row-start-2">Packs</span>
        <span className="row-start-2">Sold out in</span>
        <span className="row-start-2 text-right">Buyers</span>
        <span className="row-start-2 text-right">All</span>
        <span className="row-start-2 hidden text-right lg:block">Earlier drop</span>
        <span className="row-start-2 hidden text-right lg:block">First drop</span>
      </div>

      <ol className="border-b border-line" data-drops-rows>
        {views.map((v, i) => (
          <DropRowView key={v.d.productId} v={v} maxPacks={maxPacks} maxSold={maxSold} opensUp={i >= views.length / 2} />
        ))}
      </ol>

      <details className="group/table">
        <summary className="cursor-pointer list-none border-b border-line px-4 py-2.5 font-mono text-[10.5px] text-ink-3 transition-colors hover:text-yellow group-open/table:text-ink-2 sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="group-open/table:hidden">{`Every figure, as a table ▾`}</span>
          <span className="hidden group-open/table:inline">{`Hide the table ▴`}</span>
        </summary>
        <DropsTable views={views} />
      </details>
      <p className="px-4 py-2.5 font-mono text-[10.5px] leading-snug text-ink-4 sm:px-5" data-drops-receipt>
        {`a drop is a pack whose ${DROP_MIN_PACKS}+ paid pulls all came within ${hours(DROP_MAX_SPAN_MS)} of its first, listed once ${hours(DROP_SETTLE_MS)} pass with no sale: inferred from the pulls, Renaiss publishes no supply · sold out in = from the opening, the first of ${OPEN_BURST_PACKS} packs bought within ${OPEN_BURST_MS / 60_000} minutes (so a pack bought early doesn't start the clock), to the run's last pack · buyers are wallets · earlier drops counted from ${formatMonthDayUtc(snap.historyFrom)} · new to Renaiss = their first Renaiss pull was in that drop · packs each = packs ÷ buyers, an average${ours.length ? ` · ${andList(ours)}: names added by Varible, none in Renaiss's feed · "Drop" = no name known` : ` · "Drop" = no name in Renaiss's feed`}`}
      </p>
    </Section>
  );
}

/**
 * One drop. Below md it stacks: name and sell-out on one line, the packs bar
 * under it, the figures under that. From md it is one grid row; the breakdown
 * opens on hover or focus, upward in the lower half of the list so it stays
 * inside the card.
 */
function DropRowView({ v, maxPacks, maxSold, opensUp }: { v: DropView; maxPacks: number; maxSold: number; opensUp: boolean }) {
  const { d } = v;
  const sentence = `${v.name}, ${v.date}: ${int(d.packs)} packs, sold out in ${duration(v.soldMs)}${v.halfMs != null ? `, half gone in ${duration(v.halfMs)}` : ""}; ${int(d.buyers)} buyers, ${oneDp(v.per.all)} packs each${
    v.packs ? `; ${GROUPS.map((g) => `${g.label}: ${int(v.buyers[g.key])} buyers, ${int(v.packs![g.key])} packs`).join("; ")}` : ""
  }`;
  return (
    <li
      tabIndex={0}
      aria-label={sentence}
      className={`group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-b border-line/60 px-4 py-2.5 outline-none md:py-2 transition-colors last:border-b-0 hover:bg-bg-2/60 focus-visible:bg-bg-2/60 sm:px-5 md:gap-y-0 ${COLS}`}
    >
      <span className="min-w-0 truncate">
        <span className="text-[13px] font-semibold text-ink">{v.name}</span>
        <span className="ml-2 font-mono text-[11px] tabular text-ink-3">{v.date}</span>
      </span>
      <span className="text-right font-mono text-[12px] font-semibold tabular text-ink md:hidden">{duration(v.soldMs)}</span>

      {/* Packs, split by who bought them; the run's size at the tip. */}
      <span className="col-span-2 flex items-center gap-2 md:col-span-1">
        <span className="flex h-3 gap-[2px]" style={{ width: `calc((100% - 3rem) * ${d.packs / maxPacks})` }} aria-hidden>
          {v.packs ? (
            GROUPS.filter((g) => v.packs![g.key] > 0).map((g) => (
              <span key={g.key} className="block h-full min-w-[2px]" style={{ flex: `${v.packs![g.key]} 1 0`, background: g.color }} />
            ))
          ) : (
            <span className="block h-full flex-1 bg-ink-4" />
          )}
        </span>
        <span className="font-mono text-[12px] tabular text-ink-2">{int(d.packs)}</span>
      </span>

      {/* Sold out in, on its own time scale; the tick marks half the run gone. */}
      <span className="hidden items-center gap-2 md:flex">
        <span className="relative block h-1.5 min-w-[2px] bg-ink-3" style={{ width: `calc((100% - 4.25rem) * ${v.soldMs / maxSold})` }} aria-hidden>
          {v.halfMs != null && v.soldMs > 0 ? (
            <span className="absolute -bottom-[3px] -top-[3px] w-[2px] bg-ink" style={{ left: `min(calc(100% - 2px), ${(100 * v.halfMs) / v.soldMs}%)` }} />
          ) : null}
        </span>
        <span className="font-mono text-[12px] font-semibold tabular text-ink">{duration(v.soldMs)}</span>
      </span>

      <span className="hidden text-right font-mono text-[12.5px] tabular text-ink-2 md:block">{int(d.buyers)}</span>
      <span className="hidden text-right font-mono text-[12.5px] tabular text-ink md:block">{oneDp(v.per.all)}</span>
      <span className="hidden text-right font-mono text-[12.5px] tabular text-ink-2 lg:block">{oneDp(v.per.returning)}</span>
      <span className="hidden text-right font-mono text-[12.5px] tabular text-ink-2 lg:block">{oneDp(v.per.firstDrop)}</span>

      {/* Below md: the figures on one line (the groups' packs each are in the table view). */}
      <span className="col-span-2 font-mono text-[11px] tabular text-ink-3 md:hidden">{`${int(d.buyers)} buyers · ${oneDp(v.per.all)} packs each`}</span>

      {/* The breakdown: values lead, labels follow. */}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-4 z-20 hidden w-max max-w-[480px] border border-line bg-bg-2 px-3 py-2 text-[11.5px] leading-snug text-ink-2 shadow-lg sm:left-5 md:left-[calc(25%+1rem)] md:group-hover:block md:group-focus-visible:block ${opensUp ? "bottom-full mb-1" : "top-full mt-1"}`}
      >
        <span className="block font-semibold text-ink">{`${v.name} · ${v.date} · opened ${v.openUtc} UTC`}</span>
        <span className="mt-0.5 block whitespace-nowrap font-mono tabular">
          {`${int(d.packs)} packs · sold out in ${duration(v.soldMs)}${v.halfMs != null ? ` · half gone in ${duration(v.halfMs)}` : ""}`}
        </span>
        <span className="block font-mono tabular">{`${int(d.buyers)} buyers · ${oneDp(v.per.all)} packs each`}</span>
        <span className="mt-1.5 grid grid-cols-[12px_auto_auto] items-center gap-x-2 gap-y-1">
          {GROUPS.map((g) => (
            <span key={g.key} className="contents">
              <span className="h-[2px] w-3" style={{ background: g.color }} aria-hidden />
              <span className="whitespace-nowrap text-ink-3">{g.label}</span>
              <span className="whitespace-nowrap font-mono tabular">
                <span className="text-ink">{int(v.buyers[g.key])}</span>
                {` buyers`}
                {v.packs ? (
                  <>
                    {` · `}
                    <span className="text-ink">{int(v.packs[g.key])}</span>
                    {` packs · ${oneDp(perBuyer(v.packs[g.key], v.buyers[g.key]))} each`}
                  </>
                ) : null}
              </span>
            </span>
          ))}
        </span>
      </span>
    </li>
  );
}

/** Every figure, one row per drop: the rows' table-view twin. */
function DropsTable({ views }: { views: DropView[] }) {
  const pair = (b: number, p: number | null) => (p == null ? int(b) : `${int(b)} · ${int(p)}`);
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[1080px] border-collapse text-[12.5px]" data-drops>
        <thead>
          <tr className="border-b border-line">
            <Th>Drop</Th>
            <Th align="right">Price</Th>
            <Th align="right">Packs</Th>
            <Th align="right">Sold out in</Th>
            <Th align="right">Half gone in</Th>
            <Th align="right">Buyers</Th>
            <Th align="right">Earlier drop: buyers · packs</Th>
            <Th align="right">First drop, played before</Th>
            <Th align="right">New to Renaiss</Th>
            <Th align="right">Packs each: all · earlier · first</Th>
          </tr>
        </thead>
        <tbody>
          {views.map((v) => (
            <tr key={v.d.productId} className="[&:last-child>td]:border-b-0">
              <Td>
                <span className="font-sans font-semibold text-ink">{v.name}</span>
                <span className="ml-2 text-[11px] text-ink-3">{v.date}</span>
              </Td>
              <Td align="right" className="text-ink-2">{v.d.priceUsd == null ? "—" : `$${v.d.priceUsd}`}</Td>
              <Td align="right">{int(v.d.packs)}</Td>
              <Td align="right" className="font-semibold">{duration(v.soldMs)}</Td>
              <Td align="right" className="text-ink-2">{v.halfMs == null ? "—" : duration(v.halfMs)}</Td>
              <Td align="right" className="text-ink-2">{int(v.d.buyers)}</Td>
              <Td align="right" className="text-ink-2">{pair(v.buyers.returning, v.packs?.returning ?? null)}</Td>
              <Td align="right" className="text-ink-2">{pair(v.buyers.played, v.packs?.played ?? null)}</Td>
              <Td align="right" className="text-ink-2">{pair(v.buyers.new, v.packs?.new ?? null)}</Td>
              <Td align="right" className="text-ink-2">{`${oneDp(v.per.all)} · ${oneDp(v.per.returning)} · ${oneDp(v.per.firstDrop)}`}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th className={`whitespace-nowrap px-4 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-3 ${align === "right" ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function Td({ children, align, className = "" }: { children: React.ReactNode; align?: "right"; className?: string }) {
  return (
    <td className={`whitespace-nowrap border-b border-line/60 px-4 py-2.5 font-mono tabular text-ink ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}
