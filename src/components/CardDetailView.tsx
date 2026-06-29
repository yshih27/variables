import Link from "next/link";
import { CardImage } from "./CardImage";
import { formatCompactUsd } from "@/lib/format";
import type { CardDetail } from "@/lib/card/fetchCard";
import { FreshnessChips } from "@/components/FreshnessChip";

const GRADER_COLOR: Record<string, string> = {
  PSA: "#D62828",
  CGC: "#5fa3ff",
  BGS: "#fdff8c",
  SGC: "#a18cff",
  AGS: "#6cf48a",
};

const CHAIN_COLOR: Record<string, string> = {
  Solana: "#14f195",
  Base: "#5fa3ff",
  Polygon: "#a18cff",
  Ethereum: "#b8b8b8",
};

/** Per-platform freshness source for this card's identity/trait data. */
const FRESHNESS_SOURCE: Record<string, string> = {
  "collector-crypt": "cc-traits",
  beezie: "beezie-traits",
  phygitals: "phygitals",
};

const SOON = [
  ["Price history", "Hourly snapshots → real 7D / 30D / 1Y charts"],
  ["Across platforms", "Cheapest copy of this card on Beezie, Collector Crypt & Courtyard"],
  ["Sales & holders", "Per-card sales log, holder count and grade ladder"],
] as const;

function shortId(s: string): string {
  return s.length <= 16 ? s : `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function GradeBadge({
  grader,
  gradeNum,
  label,
}: {
  grader: string | null;
  gradeNum: number | null;
  label: string;
}) {
  if (!grader || gradeNum == null) {
    return (
      <span className="rounded-md border border-line bg-bg-2 px-2.5 py-1.5 text-[13px] text-ink-2">
        {label}
      </span>
    );
  }
  const color = GRADER_COLOR[grader.toUpperCase()] ?? "#707070";
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-line bg-bg-2 px-2.5 py-1.5 text-[14px] font-bold">
      <span style={{ color }}>{grader}</span>
      <span className="text-ink tabular">{gradeNum}</span>
    </span>
  );
}

export function CardDetailView({ card }: { card: CardDetail }) {
  const t = card.traits;
  const freshnessSource = FRESHNESS_SOURCE[card.platform];
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
      {/* Breadcrumb */}
      <div className="mb-6 text-[12px] text-ink-3">
        <Link href="/" className="transition-colors hover:text-yellow">
          Home
        </Link>
        <span className="mx-1.5">/</span>
        {t.category && (
          <>
            <Link href="/ips" className="transition-colors hover:text-yellow">
              {t.category}
            </Link>
            <span className="mx-1.5">/</span>
          </>
        )}
        <span className="text-ink-2">{card.name}</span>
      </div>

      {/* Hero */}
      <div className="grid gap-8 md:grid-cols-[minmax(0,340px)_1fr]">
        <div className="aspect-[5/7] w-full max-w-[340px]">
          <CardImage primary={card.image} fallback={card.imageFallback} alt={card.name} />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="rounded-md border border-line bg-bg-1 px-2 py-1 text-ink-2">
              {card.platformLabel}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-1 px-2 py-1 text-ink-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: CHAIN_COLOR[card.chain] ?? "#707070" }}
              />
              {card.chain}
            </span>
          </div>

          {freshnessSource && (
            <div className="mt-3">
              <FreshnessChips sources={[freshnessSource]} />
            </div>
          )}

          <h1 className="mt-4 text-[30px] font-bold leading-tight tracking-[-0.01em]">
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
            <GradeBadge grader={t.grader} gradeNum={t.gradeNum} label={card.gradeLabel} />
          </div>

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

      {/* Roadmap / honest "soon" states */}
      <section className="mt-14">
        <h2 className="text-[20px] font-semibold tracking-[-0.005em]">Card analytics</h2>
        <div className="mt-1 text-[12px] text-ink-3">
          These unlock as the new data pipeline comes online.
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {SOON.map(([title, desc]) => (
            <div key={title} className="rounded-xl border border-line/60 bg-bg-1 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold">{title}</span>
                <span className="rounded-full border border-line bg-bg-2 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-ink-3">
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
