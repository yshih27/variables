import { DROP_MAX_SPAN_MS, DROP_MIN_PACKS, DROP_SETTLE_MS, type DropRow, type RenaissDrops } from "@/lib/renaiss/drops";
import { formatMonthDayUtc } from "@/lib/format";
import { Section } from "./Section";

/**
 * Renaiss's limited drops (`renaiss-drops`): a drop-by-drop chart beside the six
 * newest, and every drop behind a toggle. The chart runs oldest to newest so a
 * reader can follow each drop's run (how long its last pack took), who bought it
 * (first-time, an earlier drop's buyers, everyone else) and its size.
 *
 * ⚠️ INFERRED, AND SAYS SO. Renaiss publishes no drop calendar or supply; the
 * receipt line states the rule (src/lib/renaiss/drops.ts) and how far back the
 * history reaches, since "bought an earlier drop" can only count drops in it.
 *
 * ⚠️ SERVER-ONLY, AND NOT RENDERED: topBuyersSharePct and buyerWallets. How
 * concentrated a drop's buying is stays private to Renaiss (owner's call, Oct 14
 * 2026), and a client component would ship the whole snapshot in the page's RSC
 * payload. Keep this a server component; the toggle is a native <details>.
 *
 * No written conclusion: each drop's figures are drawn and printed.
 */
const RECENT = 6;
const SPAN_H = 92;
const RETURNING = "var(--color-yellow)";
const FIRST = "color-mix(in srgb, var(--color-yellow) 35%, transparent)";
const OTHER = "var(--color-bg-3)";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const spanMs = (d: DropRow) => Math.max(0, Date.parse(d.lastAt) - Date.parse(d.firstAt));
const span = (fromIso: string, toIso: string): string => {
  const mins = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${String(mins % 60).padStart(2, "0")}m` : `${mins}m`;
};
/** The bar label: minutes under an hour, else hours to one decimal ("3.4h"). */
const spanShort = (ms: number) => (ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3_600_000).toFixed(1)}h`);
const packsShort = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : String(n));
const pct = (n: number, of: number) => (of > 0 ? Math.round((100 * n) / of) : 0);
const share = (n: number, of: number) => (of > 0 ? ` · ${pct(n, of)}%` : "");
const hours = (ms: number) => `${Math.round(ms / 3_600_000)} hours`;

export function RenaissDropsTable({ snap }: { snap: RenaissDrops | null | undefined }) {
  if (!snap?.drops?.length) return null;
  const drops = snap.drops;
  const oldest = drops[drops.length - 1];
  const recent = drops.slice(0, RECENT);

  return (
    <Section
      id="drops"
      className="scroll-mt-24 font-sans"
      title="Limited drops"
      readMe="one-time packs that sold their whole run within a day: how fast, and who bought"
      subtitle={`${drops.length} drops since ${formatMonthDayUtc(oldest.firstAt)} · the chart runs oldest to newest; the table, newest first`}
      flush
    >
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 border-b border-line px-4 pb-4 pt-1 sm:px-5 lg:grid-cols-2">
        <DropsChart drops={[...drops].reverse()} />
        <div className="scroll-x">
          <table className="w-full min-w-[440px] border-collapse text-[12.5px]" data-drops-recent>
            <thead>
              <tr className="border-b border-line">
                <Th>Newest {recent.length}</Th>
                <Th align="right">Packs</Th>
                <Th align="right">Last pack after</Th>
                <Th align="right">First-time</Th>
                <Th align="right">Earlier drop</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((d) => (
                <tr key={d.productId} className="[&:last-child>td]:border-b-0">
                  <Td compact>
                    <span className="font-semibold text-ink">{d.named ? d.name : "Drop"}</span>
                    <span className="ml-2 font-mono text-[11px] tabular text-ink-3">{formatMonthDayUtc(d.firstAt)}</span>
                  </Td>
                  <Td compact align="right" className="font-mono tabular text-ink">
                    {d.packs.toLocaleString("en-US")}
                  </Td>
                  <Td compact align="right" className="font-mono tabular font-semibold text-ink">
                    {span(d.firstAt, d.lastAt)}
                  </Td>
                  <Td compact align="right" className="font-mono tabular text-ink-2">
                    {`${pct(d.newPlayers, d.buyers)}%`}
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
                    <span className="font-semibold text-ink">{d.named ? d.name : "Drop"}</span>
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
        {`a drop is a pack whose ${DROP_MIN_PACKS}+ paid pulls all came within ${hours(DROP_MAX_SPAN_MS)} of its first, listed once ${hours(DROP_SETTLE_MS)} more pass with no sale: inferred from the pulls, Renaiss publishes no supply · last pack after = from the first pack sold to the last · buyers are wallets · first-time = the wallet's first Renaiss pull was in that drop · earlier drops are counted from ${formatMonthDayUtc(snap.historyFrom)} on · "Drop" = a drop Renaiss's feed gives no name`}
      </p>
    </Section>
  );
}

/**
 * Every drop, oldest to newest, one column each: how long its last pack took
 * (bar, on one linear scale, labelled), its buyers split three ways (strip:
 * an earlier drop's buyers, first-time, everyone else), its first-time share and
 * its packs, then the day and the month.
 */
function DropsChart({ drops }: { drops: DropRow[] }) {
  const max = Math.max(1, ...drops.map(spanMs));
  return (
    <div className="min-w-0" data-drops-chart>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
        <Swatch color={RETURNING} label="Bought an earlier drop" />
        <Swatch color={FIRST} label="First-time player" />
        <Swatch color={OTHER} label="Other buyers" />
      </div>
      <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2">
        <RowLabel style={{ height: SPAN_H + 14 }} className="items-end pb-1">last pack after</RowLabel>
        <div className="flex items-end gap-[3px]" style={{ height: SPAN_H + 14 }}>
          {drops.map((d) => {
            const ms = spanMs(d);
            return (
              <div key={d.productId} className="flex min-w-0 flex-1 flex-col items-center justify-end" title={`${d.named ? d.name : "Drop"} · ${formatMonthDayUtc(d.firstAt)} · last pack after ${span(d.firstAt, d.lastAt)} · ${d.packs.toLocaleString("en-US")} packs`}>
                <span className="mb-0.5 whitespace-nowrap font-mono text-[10px] leading-none tabular text-ink-2">{spanShort(ms)}</span>
                <span className="w-full bg-ink-3" style={{ height: Math.max(2, Math.round((SPAN_H * ms) / max)) }} />
              </div>
            );
          })}
        </div>

        <RowLabel className="mt-1.5 h-[18px] items-center">buyers</RowLabel>
        <div className="mt-1.5 flex h-[18px] gap-[3px]">
          {drops.map((d) => {
            const other = Math.max(0, d.buyers - d.returningBuyers - d.newPlayers);
            return (
              <div key={d.productId} className="flex min-w-0 flex-1 flex-col-reverse" title={`${formatMonthDayUtc(d.firstAt)} · ${d.buyers.toLocaleString("en-US")} buyers · ${d.returningBuyers.toLocaleString("en-US")} bought an earlier drop (${pct(d.returningBuyers, d.buyers)}%) · ${d.newPlayers.toLocaleString("en-US")} first-time (${pct(d.newPlayers, d.buyers)}%) · ${other.toLocaleString("en-US")} other`}>
                <span style={{ height: `${pct(d.returningBuyers, d.buyers)}%`, background: RETURNING }} />
                <span style={{ height: `${pct(d.newPlayers, d.buyers)}%`, background: FIRST }} />
                <span className="flex-1" style={{ background: OTHER }} />
              </div>
            );
          })}
        </div>

        <RowLabel className="mt-1 h-4 items-center">first-time</RowLabel>
        <Cells drops={drops} className="mt-1 h-4 text-ink-3" text={(d) => `${pct(d.newPlayers, d.buyers)}%`} />

        <RowLabel className="h-4 items-center">packs</RowLabel>
        <Cells drops={drops} className="h-4 text-ink-3" text={(d) => packsShort(d.packs)} />

        <span aria-hidden />
        <Cells drops={drops} className="mt-1 h-4 text-ink-4" text={(d) => String(Number(d.firstAt.slice(8, 10)))} />
        <span aria-hidden />
        <Cells
          drops={drops}
          className="h-4 text-ink-4"
          text={(d, i, all) => (i === 0 || all[i - 1].firstAt.slice(5, 7) !== d.firstAt.slice(5, 7) ? MONTHS[Number(d.firstAt.slice(5, 7)) - 1] : "")}
          align="start"
        />
      </div>
    </div>
  );
}

function Cells({
  drops,
  text,
  className = "",
  align = "center",
}: {
  drops: DropRow[];
  text: (d: DropRow, i: number, all: DropRow[]) => string;
  className?: string;
  align?: "center" | "start";
}) {
  return (
    <div className={`flex gap-[3px] font-mono text-[10px] leading-none tabular ${className}`}>
      {drops.map((d, i, all) => (
        <span key={d.productId} className={`flex min-w-0 flex-1 items-center overflow-visible whitespace-nowrap ${align === "center" ? "justify-center" : "justify-start"}`}>
          {text(d, i, all)}
        </span>
      ))}
    </div>
  );
}

function RowLabel({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={`flex font-mono text-[10px] leading-tight text-ink-4 ${className}`} style={style}>
      {children}
    </span>
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
