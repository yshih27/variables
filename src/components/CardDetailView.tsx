import Link from "next/link";
import { CardImage } from "./CardImage";
import { BuyLinks } from "./BuyLinks";
import { CardPriceHistory } from "./CardPriceHistory";
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


export function CardDetailView({ card, salesHistory }: { card: CardDetail; salesHistory: CardSalesHistory }) {
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
      {/* Breadcrumb — same "Rankings › X" trail as the IP/platform pages */}
      <div className="mb-6 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
        <Link href="/" className="hover:text-ink-2">
          Rankings
        </Link>
        <span>›</span>
        {t.category && (
          <>
            <Link href="/ips" className="hover:text-ink-2">
              {t.category}
            </Link>
            <span>›</span>
          </>
        )}
        <span className="text-ink-2">{card.name}</span>
      </div>

      {/* Hero — sealed products (booster boxes) get a squarer frame so they aren't
          letterboxed into a slab's portrait aspect (R6-1). */}
      <div className="grid gap-8 md:grid-cols-[minmax(0,340px)_1fr]">
        <div className={`${sealed ? "aspect-square" : "aspect-[5/7]"} w-full max-w-[340px]`}>
          <CardImage primary={card.image} fallback={card.imageFallback} alt={card.name} loading="eager" />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
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
            {/* The grade badge lived here and made three prints of the same fact
                on one screen (title, this chip, the GRADE row below). Dropped —
                the title carries it and the metadata table states it (R2). */}
          </div>

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
