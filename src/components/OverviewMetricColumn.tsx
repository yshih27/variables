import { SectionShell } from "./Section";
import { MetricInfo } from "./MetricInfo";
import { formatCompactUsd, formatCompactNumber } from "@/lib/format";
import type { MetricKey } from "@/lib/metrics/glossary";

/**
 * OverviewMetricColumn — the LEFT rail of the /ips overview's top zone: the
 * market's headline levels stacked beside the composite index chart. Market Cap
 * is the hero (lime); every other row is a peer.
 *
 * Each label is its own tooltip trigger (dotted underline → the glossary
 * popover) rather than carrying an ⓘ dot — six ⓘ in a 280px column read as
 * noise. Rows with real sub-data expand DefiLlama-style via a native <details>,
 * so the disclosure costs zero client JS and works keyboard-first; rows without
 * it simply have no chevron. Only `MetricInfo` (a leaf client component) hydrates.
 *
 * ⚠️ DELTA UNITS ARE NOT UNIFORM — the payload mixes two conventions, so each
 * prop below documents its own. Getting this wrong renders 100× off (see the
 * ×100 bug this pass inherited). Where no real delta exists the row shows "—";
 * nothing here is ever fabricated or defaulted to zero.
 */
type Unit = "usd" | "count";
/** One line of expanded detail — pre-formatted by the caller side of this file. */
type SubRow = { label: string; value: string };

type MetricRowData = {
  label: string;
  /** Glossary key behind the label's tooltip. */
  metric: MetricKey;
  value: number;
  unit: Unit;
  /** Change in PERCENT (already ×100), or null when no real delta exists yet. */
  deltaPct: number | null;
  /** The window the DELTA describes — the muted suffix beside it. */
  window: "24h" | "7d";
  hero?: boolean;
  /** Present → the row gets a chevron and expands. Omit when there's no real
   *  sub-data; an empty disclosure is worse than none. */
  detail?: SubRow[];
};

const fmt = (n: number, unit: Unit) =>
  unit === "usd" ? formatCompactUsd(n) : formatCompactNumber(n);

export function OverviewMetricColumn({
  mcapUsd,
  mcapPct24h,
  marketplaceVol,
  gachaVol,
  marketplacePct24h = null,
  gachaPct24h = null,
  holders,
  holdersPct7d = null,
  trades24h,
  trades24hPct = null,
  cardsTraded24h,
  vol7Usd,
  cardsTraded14d,
  mcapByCategory = [],
}: {
  mcapUsd: number;
  /** FRACTION (e.g. 0.05 = +5%), or null. */
  mcapPct24h: number | null;
  marketplaceVol: number;
  gachaVol: number;
  /** ALREADY percent (hero.vol24Pct, marketplace-only), or null. Not a fraction. */
  marketplacePct24h?: number | null;
  /** ALREADY percent (hero.gachaVol24Pct, gacha-only), or null. Not a fraction. */
  gachaPct24h?: number | null;
  /** Market-wide deduped holders. NaN until warm-holders has run → renders "—". */
  holders: number;
  /** FRACTION per the payload's declared contract, or null. Hardcoded null at the
   *  producer today (fetchHomepage), so this row always shows "—" — and it is a
   *  7d field, not 24h, hence this row's "7d" suffix. */
  holdersPct7d?: number | null;
  trades24h: number;
  /** FRACTION per the payload's declared contract, or null. Also hardcoded null
   *  at the producer today → always "—". */
  trades24hPct?: number | null;
  /** Distinct cards traded in the 24h window (Σ IPRow.cards over trading IPs).
   *  The payload carries no delta for it, so that row's delta is honestly "—". */
  cardsTraded24h: number;
  /** 7d marketplace volume — the Marketplace row's expanded detail. */
  vol7Usd: number;
  /** 14d cards-traded total from the spine — the Cards Traded row's detail. */
  cardsTraded14d: number;
  /** Qualified market cap per category — the Market Cap row's expanded split. */
  mcapByCategory?: { group: string; mcapUsd: number }[];
}) {
  // Categories with a real qualified cap only — a "$0" sub-row teaches nothing.
  const catSplit = mcapByCategory.filter((c) => Number.isFinite(c.mcapUsd) && c.mcapUsd > 0);

  const rows: MetricRowData[] = [
    {
      label: "Market Cap",
      metric: "marketCap",
      value: mcapUsd,
      unit: "usd",
      // FRACTION → percent. The two vol rows below are already percent: do NOT
      // "normalize" this asymmetry away without changing the producers.
      deltaPct: mcapPct24h != null && Number.isFinite(mcapPct24h) ? mcapPct24h * 100 : null,
      window: "24h",
      hero: true,
      detail: catSplit.length
        ? catSplit.map((c) => ({ label: c.group, value: formatCompactUsd(c.mcapUsd) }))
        : undefined,
    },
    {
      label: "24h Marketplace Vol",
      metric: "marketplace",
      value: marketplaceVol,
      unit: "usd",
      deltaPct: marketplacePct24h,
      window: "24h",
      detail:
        Number.isFinite(vol7Usd) && vol7Usd > 0
          ? [{ label: "7d volume", value: formatCompactUsd(vol7Usd) }]
          : undefined,
    },
    {
      label: "24h Gacha Vol",
      metric: "gacha",
      value: gachaVol,
      unit: "usd",
      deltaPct: gachaPct24h,
      window: "24h",
    },
    {
      label: "Holders",
      metric: "holders",
      value: holders,
      unit: "count",
      deltaPct: holdersPct7d != null && Number.isFinite(holdersPct7d) ? holdersPct7d * 100 : null,
      window: "7d",
      // No sub-split: holders is a deduped market-wide union, so a per-platform
      // breakdown would double-count anyone holding on two platforms.
    },
    {
      label: "24h Trades",
      metric: "trades",
      value: trades24h,
      unit: "count",
      deltaPct: trades24hPct != null && Number.isFinite(trades24hPct) ? trades24hPct * 100 : null,
      window: "24h",
    },
    {
      label: "24h Cards Traded",
      metric: "cardsTraded",
      value: cardsTraded24h,
      unit: "count",
      deltaPct: null,
      window: "24h",
      detail:
        cardsTraded14d > 0
          ? [{ label: "14d total", value: formatCompactNumber(cardsTraded14d) }]
          : undefined,
    },
  ];

  return (
    <SectionShell className="flex h-full flex-col divide-y divide-line">
      {rows.map((r) => (
        <MetricRow key={r.label} {...r} />
      ))}
    </SectionShell>
  );
}

function MetricRow({ label, metric, value, unit, deltaPct, window, hero, detail }: MetricRowData) {
  const head = (
    <>
      <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-3">
        <MetricInfo metric={metric}>{label}</MetricInfo>
        {detail ? <Chevron /> : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className={`font-bold leading-none tracking-[-0.01em] tabular ${
            hero ? "text-[28px] text-yellow" : "text-[21px]"
          }`}
        >
          {/* NaN (no data yet) and a real 0 both fail this guard — both are
              honestly "—" here rather than a confident zero. */}
          {value > 0 ? fmt(value, unit) : "—"}
        </span>
        <span className="flex items-center gap-1">
          {deltaPct != null && Number.isFinite(deltaPct) ? (
            <Delta pct={deltaPct} />
          ) : (
            <span className="font-mono text-[12.5px] text-ink-4">—</span>
          )}
          <span className="text-[10.5px] text-ink-4">{window}</span>
        </span>
      </div>
    </>
  );

  if (!detail) return <div className="flex flex-1 flex-col justify-center px-4 py-3">{head}</div>;

  return (
    <details className="group flex flex-1 flex-col justify-center px-4 py-3">
      {/* list-none + the webkit marker reset kill the native triangle; our own
          chevron sits beside the label instead. MetricInfo stops propagation on
          click, so hitting the label opens the tooltip without toggling the row. */}
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {head}
      </summary>
      <dl className="mt-2.5 flex flex-col gap-1 border-l border-line-2 pl-2.5">
        {detail.map((d) => (
          <div key={d.label} className="flex items-baseline justify-between gap-2">
            <dt className="text-[10.5px] text-ink-4">{d.label}</dt>
            <dd className="tabular text-[12px] font-semibold text-ink-2">{d.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** Collapsed → points right; open → points down (rotated by the parent's group-open). */
function Chevron() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      className="text-ink-4 transition-transform group-open:rotate-90"
      aria-hidden
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function Delta({ pct }: { pct: number }) {
  // ±0.05% dead-band: below that a "+0.0%" with an arrow implies a move that
  // isn't there, so it degrades to a neutral dot.
  const up = pct > 0.05;
  const down = pct < -0.05;
  const cls = up ? "text-green" : down ? "text-red" : "text-ink-3";
  const arrow = up ? "▲" : down ? "▼" : "·";
  return (
    <span className={`flex items-center gap-1 text-[12.5px] font-semibold tabular ${cls}`}>
      <span className="text-[9px]">{arrow}</span>
      {pct > 0 ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}
