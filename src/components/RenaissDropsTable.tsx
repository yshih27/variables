import { DROP_MAX_SPAN_MS, DROP_MIN_PACKS, DROP_SETTLE_MS, type DropRow, type RenaissDrops } from "@/lib/renaiss/drops";
import { formatMonthDayUtc } from "@/lib/format";
import { dropLabel } from "@/lib/renaiss/dropNames";
import { Section } from "./Section";

/**
 * Renaiss's limited drops (`renaiss-drops`): one chart of how long each drop's
 * run took, oldest to newest, beside the six newest; every drop behind a toggle.
 * Each bar is one drop, its height the hours from the first pack to the last,
 * its colour the drop's size; hover (or focus) a bar for its name, packs,
 * buyers, first-time players and earlier-drop buyers.
 *
 * ⚠️ INFERRED, AND SAYS SO. Renaiss publishes no drop calendar or supply; the
 * receipt line states the rule (src/lib/renaiss/drops.ts) and how far back the
 * history reaches, since "bought an earlier drop" can only count drops in it.
 *
 * ⚠️ SERVER-ONLY, AND NOT RENDERED: topBuyersSharePct and buyerWallets. How
 * concentrated a drop's buying is stays private to Renaiss (owner's call, Oct 14
 * 2026), and a client component would ship the whole snapshot in the page's RSC
 * payload. Keep this a server component: the hover reads are CSS and the toggle
 * is a native <details>.
 *
 * No written conclusion: the bars, the axis and each drop's figures are the read.
 */
const RECENT = 6;
const PLOT_H = 150;
/** Bar colours by drop size: the full 1,000-pack runs, and the smaller ones. */
const FULL = "var(--color-lime-dim)";
const SMALL = "var(--color-yellow)";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const spanMs = (d: DropRow) => Math.max(0, Date.parse(d.lastAt) - Date.parse(d.firstAt));
const span = (fromIso: string, toIso: string): string => {
  const mins = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${String(mins % 60).padStart(2, "0")}m` : `${mins}m`;
};
const pct = (n: number, of: number) => (of > 0 ? Math.round((100 * n) / of) : 0);
const share = (n: number, of: number) => (of > 0 ? ` · ${pct(n, of)}%` : "");
const hours = (ms: number) => `${Math.round(ms / 3_600_000)} hours`;
/** The feed's name, else Varible's (dropNames.ts), else "Drop". */
const nameOf = (d: DropRow) => dropLabel(d)?.name ?? "Drop";
/** "A, B and C". */
const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function RenaissDropsTable({ snap }: { snap: RenaissDrops | null | undefined }) {
  if (!snap?.drops?.length) return null;
  const drops = snap.drops;
  const oldest = drops[drops.length - 1];
  const recent = drops.slice(0, RECENT);
  // Names Varible added where the feed has none, oldest first, said in the receipt line.
  const ours = [...drops].reverse().flatMap((d) => {
    const l = dropLabel(d);
    return l?.source === "varible" ? [l.name.replace(/ Pack$/, "")] : [];
  });

  return (
    <Section
      id="drops"
      className="scroll-mt-24 font-sans"
      title="Limited drops"
      readMe="one-time packs that sold their whole run within a day: how fast, and who bought"
      subtitle={`${drops.length} drops since ${formatMonthDayUtc(oldest.firstAt)}`}
      flush
    >
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 border-b border-line px-4 pb-4 pt-1 sm:px-5 lg:grid-cols-2">
        <DropsChart drops={[...drops].reverse()} />
        <div className="scroll-x">
          <table className="w-full min-w-[400px] border-collapse text-[12.5px]" data-drops-recent>
            <thead>
              <tr className="border-b border-line">
                <Th>Newest {recent.length}</Th>
                <Th align="right">Packs</Th>
                <Th align="right">Last pack after</Th>
                <Th align="right">Bought an earlier drop</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((d) => (
                <tr key={d.productId} className="[&:last-child>td]:border-b-0">
                  <Td compact>
                    <span className="font-semibold text-ink">{nameOf(d)}</span>
                    <span className="ml-2 font-mono text-[11px] tabular text-ink-3">{formatMonthDayUtc(d.firstAt)}</span>
                  </Td>
                  <Td compact align="right" className="font-mono tabular text-ink">
                    {d.packs.toLocaleString("en-US")}
                  </Td>
                  <Td compact align="right" className="font-mono tabular font-semibold text-ink">
                    {span(d.firstAt, d.lastAt)}
                  </Td>
                  <Td compact align="right" className="font-mono tabular text-ink-2">
                    {`${pct(d.returningBuyers, d.buyers)}%`}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <details className="group">
        <summary className="cursor-pointer list-none border-b border-line px-4 py-2.5 font-mono text-[10.5px] text-ink-3 transition-colors hover:text-yellow group-open:text-ink-2 sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">{`Show all ${drops.length} drops ▾`}</span>
          <span className="hidden group-open:inline">{`Hide the ${drops.length} drops ▴`}</span>
        </summary>
        <div className="scroll-x">
          <table className="w-full min-w-[800px] border-collapse text-[13px]" data-drops>
            <thead>
              <tr className="border-b border-line">
                <Th>Drop</Th>
                <Th align="right">Price</Th>
                <Th align="right">Packs</Th>
                <Th align="right">Last pack after</Th>
                <Th align="right">Buyers</Th>
                <Th align="right">First-time players</Th>
                <Th align="right">Bought an earlier drop</Th>
              </tr>
            </thead>
            <tbody>
              {drops.map((d) => (
                <tr key={d.productId} className="[&:last-child>td]:border-b-0">
                  <Td>
                    <span className="font-semibold text-ink">{nameOf(d)}</span>
                    <span className="ml-2 font-mono text-[11px] tabular text-ink-3">{formatMonthDayUtc(d.firstAt)}</span>
                  </Td>
                  <Td align="right" className="font-mono tabular text-ink-2">
                    {d.priceUsd == null ? "—" : `$${d.priceUsd}`}
                  </Td>
                  <Td align="right" className="font-mono tabular text-ink">
                    {d.packs.toLocaleString("en-US")}
                  </Td>
                  <Td align="right" className="font-mono tabular font-semibold text-ink">
                    {span(d.firstAt, d.lastAt)}
                  </Td>
                  <Td align="right" className="font-mono tabular text-ink-2">
                    {d.buyers.toLocaleString("en-US")}
                  </Td>
                  <Td align="right" className="font-mono tabular text-ink-2">
                    {`${d.newPlayers.toLocaleString("en-US")}${share(d.newPlayers, d.buyers)}`}
                  </Td>
                  <Td align="right" className="font-mono tabular text-ink-2">
                    {`${d.returningBuyers.toLocaleString("en-US")}${share(d.returningBuyers, d.buyers)}`}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="px-4 py-2.5 font-mono text-[10.5px] leading-snug text-ink-4 sm:px-5" data-drops-receipt>
        {`a drop is a pack whose ${DROP_MIN_PACKS}+ paid pulls all came within ${hours(DROP_MAX_SPAN_MS)} of its first, listed once ${hours(DROP_SETTLE_MS)} pass with no sale: inferred from the pulls, Renaiss publishes no supply · buyers are wallets · first-time = their first Renaiss pull was in that drop · earlier drops counted from ${formatMonthDayUtc(snap.historyFrom)}${ours.length ? ` · ${andList(ours)}: names added by Varible, none in Renaiss's feed · "Drop" = no name known` : ` · "Drop" = no name in Renaiss's feed`}`}
      </p>
    </Section>
  );
}

/**
 * Every drop, oldest to newest: one bar each, its height the hours from the
 * first pack to the last on one linear axis (gridlines every 6 hours), its
 * colour the drop's size. Months label the axis; each bar's figures are in its
 * hover, so nothing else is printed on the plot.
 */
function DropsChart({ drops }: { drops: DropRow[] }) {
  const hoursOf = (d: DropRow) => spanMs(d) / 3_600_000;
  const top = Math.max(6, Math.ceil(Math.max(...drops.map(hoursOf)) / 6) * 6);
  const grid = Array.from({ length: top / 6 }, (_, i) => (i + 1) * 6);
  const smallSizes = [...new Set(drops.filter((d) => d.packs < 1000).map((d) => d.packs))].sort((a, b) => a - b);
  const smallLabel = smallSizes.length ? `${smallSizes[0].toLocaleString("en-US")}${smallSizes.length > 1 ? `–${smallSizes[smallSizes.length - 1].toLocaleString("en-US")}` : ""} packs` : null;

  return (
    <div className="flex min-w-0 flex-col" data-drops-chart>
      <div className="mb-3 flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-[12px] text-ink-2">Hours from the first pack to the last</span>
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
          <Swatch color={FULL} label="1,000 packs" />
          {smallLabel ? <Swatch color={SMALL} label={smallLabel} /> : null}
        </span>
      </div>
      {/* The plot fills the card beside the table (its row's height), never under PLOT_H. */}
      <div className="grid min-h-0 flex-1 grid-cols-[30px_minmax(0,1fr)] gap-x-2" style={{ gridTemplateRows: `minmax(${PLOT_H}px, 1fr) auto` }}>
        <div className="relative font-mono text-[10px] text-ink-4" aria-hidden>
          {grid.map((g) => (
            <span key={g} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (100 * g) / top}%` }}>
              {g}h
            </span>
          ))}
        </div>
        <div className="relative">
          {grid.map((g) => (
            <span key={g} className="absolute inset-x-0 h-px bg-line/60" style={{ top: `${100 - (100 * g) / top}%` }} aria-hidden />
          ))}
          <span className="absolute inset-x-0 bottom-0 h-px bg-line" aria-hidden />
          <div className="absolute inset-0 flex items-end gap-[5px]">
            {drops.map((d, i) => {
              // The read opens toward the plot's middle, so an edge bar's stays inside the card.
              const side = i < drops.length / 3 ? "left-0" : i >= (2 * drops.length) / 3 ? "right-0" : "left-1/2 -translate-x-1/2";
              const sentence = `${nameOf(d)}, ${formatMonthDayUtc(d.firstAt)}: ${d.packs.toLocaleString("en-US")} packs, last pack after ${span(d.firstAt, d.lastAt)}; ${d.buyers.toLocaleString("en-US")} buyers, ${pct(d.returningBuyers, d.buyers)}% bought an earlier drop, ${pct(d.newPlayers, d.buyers)}% first-time players`;
              return (
                <div
                  key={d.productId}
                  tabIndex={0}
                  role="img"
                  aria-label={sentence}
                  className="group relative flex h-full min-w-0 flex-1 items-end outline-none focus-visible:ring-1 focus-visible:ring-yellow/60"
                >
                  {/* The bar carries its read: the tooltip opens just above the bar's top,
                      wherever that is, not at the top of the plot. */}
                  <span
                    className="relative block w-full"
                    style={{ height: `max(2px, ${(100 * hoursOf(d)) / top}%)` }}
                  >
                    <span
                      className="block h-full w-full transition-opacity group-hover:opacity-80"
                      style={{ background: d.packs < 1000 ? SMALL : FULL }}
                    />
                    <span
                      role="tooltip"
                      className={`pointer-events-none absolute bottom-full ${side} z-20 mb-1.5 hidden w-max max-w-[260px] border border-line bg-bg-2 px-2.5 py-1.5 text-[11.5px] leading-snug text-ink-2 shadow-lg group-hover:block group-focus:block`}
                    >
                      <span className="block font-semibold text-ink">{`${nameOf(d)} · ${formatMonthDayUtc(d.firstAt)}`}</span>
                      <span className="block font-mono tabular">{`${d.packs.toLocaleString("en-US")} packs · last pack after ${span(d.firstAt, d.lastAt)}`}</span>
                      <span className="block font-mono tabular">{`${d.buyers.toLocaleString("en-US")} buyers · ${pct(d.returningBuyers, d.buyers)}% bought an earlier drop · ${pct(d.newPlayers, d.buyers)}% first-time`}</span>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <span aria-hidden />
        <div className="mt-1.5 flex gap-[5px] font-mono text-[10px] text-ink-4" aria-hidden>
          {drops.map((d, i) => (
            <span key={d.productId} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
              {i === 0 || drops[i - 1].firstAt.slice(5, 7) !== d.firstAt.slice(5, 7) ? MONTHS[Number(d.firstAt.slice(5, 7)) - 1] : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 shrink-0 border border-line" style={{ background: color }} />
      <span className="text-ink-2">{label}</span>
    </span>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`px-4 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, align, className = "", compact = false }: { children: React.ReactNode; align?: "right"; className?: string; compact?: boolean }) {
  return (
    <td className={`whitespace-nowrap border-b border-line/60 ${compact ? "px-3 py-2.5" : "px-4 py-3"} ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}
