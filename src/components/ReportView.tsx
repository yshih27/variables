import Link from "next/link";
import { Section } from "./Section";
import { formatCompactUsd, formatPct } from "@/lib/format";
import { cardHref } from "@/lib/card/ids";
import { tickerOf, INDEX_FAMILY_SHORT } from "@/lib/indices/naming";
import type {
  MoverBoard,
  ReportBenchmark,
  ReportMover,
  ReportPull,
  ReportSale,
  WeeklyReport,
} from "@/lib/data/weeklyReport";

/** Green / red / neutral for a signed percent (matches the app's ±0.05% dead-band). */
function pctClass(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "text-ink-3";
  if (p > 0.05) return "text-green";
  if (p < -0.05) return "text-red";
  return "text-ink-3";
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const BENCH_LABEL: Record<ReportBenchmark["symbol"], string> = {
  BTC: "BTC",
  ETH: "ETH",
  SP500: "S&P 500",
  NASDAQ: "NASDAQ",
  GOLD: "Gold",
};

const BOARDS: { key: keyof WeeklyReport["movers"]; title: string; hrefOf: (k: string) => string }[] = [
  { key: "ipVolume", title: "IP · volume", hrefOf: (k) => `/ip/${k}` },
  { key: "ipMcap", title: "IP · market cap", hrefOf: (k) => `/ip/${k}` },
  { key: "platformVolume", title: "Platform · volume", hrefOf: (k) => `/platform/${k}` },
  { key: "setVolume", title: "Set · volume", hrefOf: (k) => `/ip/${k.split(":")[0]}` },
];

/**
 * Renders the weekly-report snapshot (backend B9-2 `WeeklyReport`) as a shareable
 * page (F9-2). Pure server component; every section is defensive (any array may
 * be empty), so a partially-composed report still renders cleanly.
 */
export function ReportView({ report }: { report: WeeklyReport }) {
  const anyMovers = BOARDS.some((b) => {
    const board = report.movers[b.key];
    return board.gainers.length > 0 || board.losers.length > 0;
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Headline: index / market cap / weekly volume */}
      <Section
        title="The market this week"
        subtitle={`${INDEX_FAMILY_SHORT[0].toUpperCase()}${INDEX_FAMILY_SHORT.slice(1)}, market cap and volume — week over week, all on-chain`}
        flush
      >
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-line sm:grid-cols-3">
          <StatTile label={tickerOf("market", "total")} value={formatPct(report.index.wowPct)} tone={report.index.wowPct} sub="week over week" big />
          <StatTile
            label="Market cap"
            value={report.mcap.totalUsd != null ? formatCompactUsd(report.mcap.totalUsd) : "—"}
            sub={formatPct(report.mcap.wowPct)}
            subTone={report.mcap.wowPct}
          />
          <StatTile
            label="Tracked volume"
            value={formatCompactUsd(report.volume.weekUsd)}
            sub={formatPct(report.volume.wowPct)}
            subTone={report.volume.wowPct}
          />
        </div>
      </Section>

      {/* vs benchmarks (spread = index WoW − benchmark WoW) */}
      {report.benchmarks.length > 0 && (
        <Section title="vs benchmarks" subtitle="Index return minus each benchmark, this week" flush>
          <div className="flex flex-wrap gap-2.5 px-4 pb-4 pt-1 sm:px-5 sm:pb-5">
            {report.benchmarks.map((b) => (
              <div key={b.symbol} className="flex items-center gap-2 rounded-lg border border-line bg-bg-1 px-3 py-2">
                <span className="text-[12px] text-ink-3">vs {BENCH_LABEL[b.symbol]}</span>
                <span className={`tabular text-[13px] font-semibold ${pctClass(b.spreadPct)}`}>
                  {formatPct(b.spreadPct)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Movers — four boards */}
      {anyMovers && (
        <div className="grid gap-6 md:grid-cols-2">
          {BOARDS.map((b) => (
            <MoverBoardCard key={b.key} title={b.title} board={report.movers[b.key]} hrefOf={b.hrefOf} />
          ))}
        </div>
      )}

      {/* Biggest sales */}
      {report.biggestSales.length > 0 && (
        <Section title="Biggest sales" subtitle="Largest single sales this week" flush>
          <ul className="divide-y divide-line/60">
            {report.biggestSales.map((s, i) => (
              <SaleRow key={`${s.platform}:${s.tokenId}:${i}`} sale={s} />
            ))}
          </ul>
        </Section>
      )}

      {/* Notable pulls */}
      {report.notablePulls.length > 0 && (
        <Section title="Notable pulls" subtitle="Biggest gacha hits this week" flush>
          <ul className="divide-y divide-line/60">
            {report.notablePulls.map((p, i) => (
              <PullRow key={`${p.platform}:${p.name}:${i}`} pull={p} />
            ))}
          </ul>
        </Section>
      )}

      <p className="px-1 text-[11.5px] text-ink-4">
        Reporting week {fmtDate(report.weekStart)} – {fmtDate(report.weekEnd)}. Every figure is derived
        from on-chain reads.{" "}
        <Link href="/methodology" className="underline-offset-2 hover:text-yellow hover:underline">
          Methodology →
        </Link>
      </p>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
  sub,
  subTone,
  big,
}: {
  label: string;
  value: string;
  tone?: number | null;
  sub?: string;
  subTone?: number | null;
  big?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 bg-bg-1 px-5 py-5">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">{label}</span>
      <span className={`tabular font-semibold ${big ? "text-[40px]" : "text-[26px]"} ${tone !== undefined ? pctClass(tone) : "text-ink"}`}>
        {value}
      </span>
      {sub && (
        <span className={`tabular text-[12px] ${subTone !== undefined ? pctClass(subTone) : "text-ink-3"}`}>
          {sub}
          {subTone !== undefined ? " WoW" : ""}
        </span>
      )}
    </div>
  );
}

function MoverBoardCard({ title, board, hrefOf }: { title: string; board: MoverBoard; hrefOf: (k: string) => string }) {
  if (board.gainers.length === 0 && board.losers.length === 0) return null;
  return (
    <Section title={title} flush>
      <div className="flex flex-col">
        {board.gainers.map((m) => (
          <MoverRow key={`g:${m.key}`} m={m} href={hrefOf(m.key)} arrow="▲" />
        ))}
        {board.losers.map((m) => (
          <MoverRow key={`l:${m.key}`} m={m} href={hrefOf(m.key)} arrow="▼" />
        ))}
      </div>
    </Section>
  );
}

function MoverRow({ m, href, arrow }: { m: ReportMover; href: string; arrow: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 border-b border-line/60 px-5 py-3 transition-colors last:border-0 hover:bg-bg-2"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className={`text-[11px] ${pctClass(m.pct)}`}>{arrow}</span>
        <span className="truncate font-sans text-[13px] font-medium">{m.name}</span>
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <span className="tabular text-[11.5px] text-ink-4">{formatCompactUsd(m.currentUsd)}</span>
        <span className={`tabular w-[62px] text-right text-[13px] font-semibold ${pctClass(m.pct)}`}>
          {formatPct(m.pct)}
        </span>
      </span>
    </Link>
  );
}

function SaleRow({ sale }: { sale: ReportSale }) {
  const href = cardHref(sale.platform, sale.tokenId);
  const inner = (
    <>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-sans text-[13.5px] font-medium">{sale.name}</span>
        <span className="text-[11.5px] text-ink-3">
          {sale.ip !== "other" ? `${sale.ip} · ` : ""}
          {sale.platform} · {fmtDate(sale.date)}
        </span>
      </span>
      <span className="tabular shrink-0 text-[13.5px] font-semibold text-ink">{formatCompactUsd(sale.priceUsd)}</span>
    </>
  );
  return (
    <li>
      {href !== "#" ? (
        <Link href={href} className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-bg-2">
          {inner}
        </Link>
      ) : (
        <div className="flex items-center justify-between gap-3 px-5 py-3.5">{inner}</div>
      )}
    </li>
  );
}

function PullRow({ pull }: { pull: ReportPull }) {
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3.5">
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-sans text-[13.5px] font-medium">{pull.name}</span>
        <span className="text-[11.5px] text-ink-3">
          {pull.platform}
          {pull.pack ? ` · ${pull.pack}` : ""}
        </span>
      </span>
      <span className="tabular shrink-0 text-[13.5px] font-semibold text-yellow">{formatCompactUsd(pull.valueUsd)}</span>
    </li>
  );
}
