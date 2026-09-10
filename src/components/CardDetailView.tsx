import Link from "next/link";
import { CardImage } from "./CardImage";
import { MetricInfo } from "./MetricInfo";
import { BuyLinks } from "./BuyLinks";
import { CardPriceHistory } from "./CardPriceHistory";
import { formatMonthDayUtc } from "@/lib/format";
import type { OracleLookup } from "@/lib/ripfun/oracle";
import { formatCompactUsd } from "@/lib/format";
import type { CardDetail } from "@/lib/card/fetchCard";
import type { CardSalesHistory } from "@/lib/data/cardSales";
import { buyLinks } from "@/lib/links/buyLinks";
import { isSealed } from "@/lib/card/sealed";

const CHAIN_COLOR: Record<string, string> = {
  Solana: "#14f195",
  Base: "#5fa3ff",
  Polygon: "#a18cff",
  Ethereum: "#b8b8b8",
};

// "Price history" graduated out of this list into its own real section (F9-3).
const SOON = [
  ["Across platforms", "Cheapest copy of this card on Beezie, Collector Crypt & Courtyard"],
  ["Sales & holders", "Per-card sales log, holder count and grade ladder"],
] as const;

function shortId(s: string): string {
  return s.length <= 16 ? s : `${s.slice(0, 6)}…${s.slice(-4)}`;
}


export function CardDetailView({
  card,
  salesHistory,
  comp,
}: {
  card: CardDetail;
  salesHistory: CardSalesHistory;
  /** CardOS comp for this printing at this grade, or null. See <CompRow>. */
  comp?: OracleLookup | null;
}) {
  const t = card.traits;
  const sealed = isSealed(card.name, card.gradeLabel);
  // Buy venues only — the resolver's Solscan entry is dropped here because the
  // on-chain link already lives in the token footer below (and covers Basescan
  // for Beezie too, not just Solana).
  const links = buyLinks({ platform: card.platform, chain: card.chain, tokenId: card.tokenId }).filter(
    (l) => l.platform !== "solscan",
  );
  const byLabel = new Map(card.attributes.map((a) => [a.label.toLowerCase(), a.value]));
  const attr = (k: string) => byLabel.get(k.toLowerCase()) ?? null;

  const insured = t.insuredValueUsd != null && t.insuredValueUsd > 0 ? t.insuredValueUsd : null;
  const insuredLabel =
    card.platform === "collector-crypt"
      ? "Insured value · CC vault appraisal"
      : "Insured value";

  const facts: Array<[string, string | null]> = [
    ["Category", t.category],
    ["Set", t.set],
    ["Year", t.year ? String(t.year) : null],
    ["Grade", card.gradeLabel],
    ["Language", attr("Language")],
    ["Type", attr("Type") ?? attr("Format")],
  ];

  return (
    <>

      {/* Hero — sealed products (booster boxes) get a squarer frame so they aren't
          letterboxed into a slab's portrait aspect (R6-1). */}
      <div className="grid gap-8 md:grid-cols-[minmax(0,340px)_1fr]">
        <div className={`${sealed ? "aspect-square" : "aspect-[5/7]"} w-full max-w-[340px]`}>
          <CardImage primary={card.image} fallback={card.imageFallback} alt={card.name} loading="eager" />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            {/* The one navigation the breadcrumb actually carried, kept inline as
                a chip. It points at /ips, not /ip/[key], because CardDetail has
                no ip key — only a display category ("Riftbound") — and matching
                that back to a catalog key would be a guess. */}
            {t.category ? (
              <Link
                href="/ips"
                className="rounded-md border border-line bg-bg-1 px-2 py-1 text-ink-2 transition-colors hover:border-yellow/40 hover:text-yellow"
              >
                {t.category}
              </Link>
            ) : null}
            <span className="rounded-md border border-line bg-bg-1 px-2 py-1 text-ink-2">
              {card.platformLabel}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-1 px-2 py-1 text-ink-2">
              <span
                className="h-2 w-2 rounded-none"
                style={{ background: CHAIN_COLOR[card.chain] ?? "#707070" }}
              />
              {card.chain}
            </span>
          </div>

          <h1 className="mt-3 text-[22px] font-bold leading-tight tracking-[-0.01em]">
            {card.name}
          </h1>
          {(t.set || t.year) && (
            <div className="mt-1.5 text-[14px] text-ink-2">
              {[t.set, t.year ? String(t.year) : null].filter(Boolean).join(" · ")}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-end gap-x-10 gap-y-4">
            {insured != null && (
              <div>
                <div className="text-[34px] font-bold leading-none tabular">
                  {formatCompactUsd(insured)}
                </div>
                <div className="mt-1.5 text-[11px] uppercase tracking-[0.06em] text-ink-3">
                  {insuredLabel}
                </div>
              </div>
            )}
            {/* No grade chip here, under any condition (R2). The grade is
                already stated twice on this screen: printed on the slab in the
                hero photo, and in the GRADE row of the metadata table below. A
                chip beside the price was a third print — and that holds whether
                or not the title happens to carry the grade too, which is why
                this isn't conditional. GradeChip stays the shared component for
                Top Sales and the tables. */}
          </div>

          <CompRow lookup={comp} gradeLabel={card.gradeLabel} />

          {/* Primary CTA — buy this card (Rarible-first). */}
          {links.length > 0 && (
            <div className="mt-7">
              <BuyLinks links={links} />
            </div>
          )}

          <dl className="mt-7 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{k}</dt>
                <dd className="mt-1 text-[13px] text-ink">{v ?? "—"}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-7 flex items-center gap-3 text-[12px] text-ink-3">
            <span className="font-mono">{shortId(card.tokenId)}</span>
            {card.explorerUrl && (
              <a
                href={card.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 transition-colors hover:text-yellow hover:underline"
              >
                View on-chain ↗
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Real price history (F9-3) — sparse-honest realized sales. */}
      <CardPriceHistory history={salesHistory} />

      {/* Roadmap / honest "soon" states */}
      <section className="mt-14">
        <h2 className="text-[20px] font-semibold tracking-[-0.005em]">Card analytics</h2>
        <div className="mt-1 text-[12px] text-ink-3">
          These unlock as the new data pipeline comes online.
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {SOON.map(([title, desc]) => (
            <div key={title} className="rounded-xl border border-line/60 bg-bg-1 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold">{title}</span>
                <span className="rounded-none border border-line bg-bg-2 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-ink-3">
                  Soon
                </span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* All attributes (real data) */}
      {card.attributes.length > 0 && (
        <section className="mt-14">
          <h2 className="text-[20px] font-semibold tracking-[-0.005em]">All attributes</h2>
          <dl className="mt-4 grid grid-cols-1 gap-x-10 sm:grid-cols-2">
            {card.attributes.map((a) => (
              <div
                key={a.label}
                className="flex items-center justify-between gap-4 border-b border-line/60 py-2.5 text-[13px]"
              >
                <dt className="text-ink-3">{a.label}</dt>
                <dd className="max-w-[60%] truncate text-right font-medium text-ink">
                  {a.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
}


/**
 * The CardOS comp — a THIRD-PARTY estimate of what this printing is worth
 * elsewhere, shown as CONTEXT beside our realized figures.
 *
 * ⚠️ IT MUST BE IMPOSSIBLE TO MISREAD AS OUR PRICE. Three things enforce that and
 * none of them is optional:
 *   • it is labelled "comp", never "price", and always carries "CardOS comps" —
 *     provenance travels WITH the number, so it cannot be quoted bare;
 *   • it is mono, 11.5px and ink-4, deliberately subordinate to the 34px insured
 *     value above it — a reader scanning for the price cannot land here first;
 *   • it enters nothing. No chart, no stat, no Σ. The oracle module makes a comp
 *     an OBJECT rather than a number precisely so `total += comp` will not
 *     compile; this component reads `.usd` once, to print it.
 *
 * ⚠️ HONEST ABSENCE. No comp → this renders NOTHING. Not a dash, not "no comp
 * available". About 28% of traded printings have no CardOS mapping by
 * construction (Base-Set-era cards, and the non-CardOS games — sports, Yu-Gi-Oh),
 * and a missing CONTEXT row is not a gap in our data. A placeholder would
 * manufacture the impression that something failed.
 *
 * ⚠️ A GRADED CARD GETS ITS OWN RUNG OR NOTHING. The reader returns null for a
 * grade CardOS does not value rather than falling back to the raw price — a PSA
 * 10 and a loose copy routinely differ by an order of magnitude.
 */
function CompRow({ lookup, gradeLabel }: { lookup?: OracleLookup | null; gradeLabel: string }) {
  const c = lookup?.comp;
  if (!c) return null;

  // CardOS's OWN recompute time, never our fetch time — the age a reader cares
  // about is how stale the estimate is, not how recently we copied it. Omitted
  // entirely when CardOS sent none; an invented date is worse than no date.
  const asOf = formatMonthDayUtc(c.updated);

  const parts = [
    "CardOS comps",
    asOf ? `as of ${asOf}` : null,
    // A "feed" value is a model output with no sales behind it. The oracle
    // contract calls this out explicitly: printing it next to settled trades
    // without saying so puts an estimate and a real sale in one column.
    c.basis === "feed" ? "estimate" : null,
    // Never hidden. CardOS's own confidence, surfaced only when it is not high —
    // a "high confidence" suffix on every row would be noise that trains readers
    // to skip the line where it matters.
    c.confidence === "low" || c.confidence === "med" ? `${c.confidence} confidence` : null,
  ].filter(Boolean);

  return (
    <div className="mt-4 font-mono text-[11.5px] leading-snug text-ink-4">
      <span className="text-ink-2">
        {/* The grade prefix names WHICH card this comp is for. Only when the
            lookup actually matched that grade's rung — `isRaw` says it did not. */}
        {!lookup?.isRaw && gradeLabel ? `${gradeLabel} ` : ""}comp{" "}
        <span className="tabular font-semibold">{`$${c.usd.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`}</span>
      </span>
      <span className="ml-1.5">· {parts.join(" · ")}</span>
      <MetricInfo metric="compPrice" className="ml-1.5" />
      <CompLadder lookup={lookup} />
    </div>
  );
}

/**
 * The rest of CardOS's graded ladder, behind a plain <details>.
 *
 * Chosen over the ⓘ because the ⓘ carries the DEFINITION (one string, the same on
 * every card) while this is per-card DATA — and over a client component because a
 * disclosure needs no JavaScript. Collapsed by default: the ladder is reference,
 * not the headline, and the row above is the thing this section is for.
 *
 * ⚠️ EVERY RUNG IS A COMP, so each carries the same subordinate treatment as the
 * row above. Hidden entirely when there is nothing more to show than what is
 * already displayed — a disclosure that opens onto one repeated line is noise.
 */
function CompLadder({ lookup }: { lookup: OracleLookup }) {
  const rungs = lookup.printing.graded;
  if (rungs.length < 2) return null;

  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer list-none text-ink-4 transition-colors hover:text-ink-3">
        graded ladder ({rungs.length}) ▾
      </summary>
      <ul className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {rungs.map((r) => (
          <li key={`${r.grader}-${r.grade}`} className="flex items-baseline justify-between gap-2">
            <span className="text-ink-3">{r.label}</span>
            <span className="tabular text-ink-2">
              {`$${r.comp.usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
