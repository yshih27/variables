import { NavBar } from "@/components/NavBar";
import { indexRegistry, INDEX_FAMILY, INDEX_FAMILY_SHORT } from "@/lib/indices/naming";
import { X_URL } from "@/lib/site";

// Static hand-authored content — cache it and revalidate hourly instead of
// re-rendering per request (F8-4).
export const revalidate = 3600;

export const metadata = {
  title: "Methodology · VARIBLE",
  description:
    "How VARIBLE computes market cap, holders, volume, primary revenue, and gacha statistics — every number sourced directly from on-chain data.",
};

export default function MethodologyPage() {
  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[820px] px-8 pt-10 pb-24 font-sans">

        <header className="mb-6">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-3">
            Transparency
          </span>
          <h1 className="mt-1.5 text-[20px] font-bold leading-none tracking-[-0.01em]">
            How we measure.
          </h1>
          <p className="mt-4 max-w-[640px] text-[14px] leading-relaxed text-ink-2">
            Every number on VARIBLE is derived from on-chain reads. No
            partner APIs, no aggregator black boxes, no marketing-deck math.
            This page documents the formula behind every metric so you can
            audit our numbers.
          </p>
        </header>

        <Section title="Sources">
          <p>
            We index four platforms directly against their canonical chains.
            Every metric on the site flows from one of these primitives:
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-[13.5px]">
            <SrcLi
              label="Beezie"
              chain="Base"
              source="Native marketplace contract + ERC-721 collection, read directly from Base."
            />
            <SrcLi
              label="Courtyard"
              chain="Polygon"
              source="Native marketplace contract + USDC inflow tracking to tokenization wallets for primary-market fees."
            />
            <SrcLi
              label="Collector Crypt"
              chain="Solana"
              source="Helius DAS for trait + ownership data; Helius Enhanced TX for marketplace sale parsing; SPL-USDC transfer indexing for gacha pull revenue."
            />
            <SrcLi
              label="Phygitals"
              chain="Solana"
              source="SPL-USDC transfer indexing for gacha pull revenue. NFT collection not yet wired."
            />
          </ul>
        </Section>

        <Section title="Index naming" id="naming">
          <p>
            Every index we publish belongs to one family:{" "}
            <span className="font-semibold text-ink">{INDEX_FAMILY}</span> (nickname &quot;
            {INDEX_FAMILY_SHORT}&quot;). Each is a constant-quality price index — the trade-weighted
            stratified-median sale price within set×grade cells, rebased to 100 at inception — and
            carries a <code>V-</code> ticker derived from the entity&apos;s short code, so the scheme
            never drifts as the catalog grows. The whole market is <code>V-MKT</code>; each category
            and named IP has its own. The public API echoes each index&apos;s ticker, which
            makes this registry the canonical one.
          </p>
          <ul className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
            {indexRegistry().map((idx) => (
              <li
                key={idx.ticker}
                className="flex items-baseline justify-between gap-3 border-b border-line/50 py-1 text-[13px]"
              >
                <code className="text-yellow">{idx.ticker}</code>
                <span className="text-ink-3">{idx.name}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Market Cap">
          <p>
            Per-token value is the cheapest active USD listing on the
            platform&apos;s order book. For Collector Crypt we use the{" "}
            <em>Insured Value</em> trait (PWCC vault appraisal) since most CC
            tokens aren&apos;t actively listed.
          </p>
          <ul className="mt-3 list-disc pl-5 text-[13.5px] leading-relaxed">
            <li>Floor per IP = min per-token value within the IP.</li>
            <li>Market cap per IP = sum of per-token values across all tracked platforms.</li>
            <li>Spam filter: token values outside <code>[$1, $5M]</code> are dropped.</li>
            <li>Hidden when total mcap &lt; $1K — surfaces as <code>—</code> rather than a figure too small to mean anything. A cap is never gated on 24h trading: what changed hands today doesn&apos;t change what the float is worth.</li>
          </ul>
        </Section>

        <Section title="24h Volume + Trades">
          <p>
            Sum of qualifying secondary-market sales in the last rolling 24h, read
            from each platform&apos;s own feed: native marketplace contracts for Beezie
            and Courtyard, and a USDC + NFT same-transaction heuristic against the
            Collector Crypt marketplace program. Phygitals&apos; secondary market has no
            source yet, so its resale figures read <code>—</code> rather than zero.
          </p>
          <p className="mt-3">
            <span className="font-semibold text-ink">Active 24h</span> = the
            union of unique buyer + seller wallets (set union, not sum). Same
            wallet on both sides counts once.
          </p>
        </Section>

        <Section title="Primary Revenue (Gacha + Tokenization)">
          <p>
            For each platform with a primary-market mechanic we maintain a
            disk cache populated by{" "}
            <code className="rounded-md bg-bg-2 px-1.5 py-0.5">npm run warm-primary-revenue</code>:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-line/60 bg-bg-1 p-4 text-[12px] leading-relaxed text-ink-2">
{`primary_revenue = Σ ( USDC inflow into platform.gacha_receivers
                      from senders NOT in platform.internal_exclusions )

For CC: filter to canonical pull prices [$25, $50, $75, $80, $100, $151, $250, $1000, $2500, $5000]
For Phygitals/Courtyard: count every inbound USDC transfer.`}
          </pre>
          <p className="mt-3">
            Internal exclusions are addresses we&apos;ve identified as
            treasury / rarity-bucket / house wallets — transfers from them to
            a receiver represent internal moves, not user revenue.
          </p>
        </Section>

        <Section title="Holders">
          <p>
            Per-IP holders count = unique on-chain owners holding at least
            one card in that IP. Per-platform holders count = unique owners
            holding any card on that platform.
          </p>
          <p className="mt-3 text-ink-3">
            The cross-platform total is a strict union, not a sum: a wallet holding
            cards on both Beezie and Collector Crypt counts once. That is why the
            headline holder count is lower than adding the per-platform numbers
            together — the difference is the overlap, not a missing platform.
          </p>
        </Section>

        <Section title="Gacha — Pulls, Volume, Pack Prices">
          <p>
            A pull is a USDC payment into a platform&apos;s gacha-receiver
            wallet. We bucket pulls by exact amount: for platforms with a
            published price ladder we filter to that ladder; for others we
            round to the nearest dollar.
          </p>
          <p className="mt-3">
            <span className="font-semibold text-ink">EV (coming soon)</span>{" "}
            = average appraised value of the NFT pulled in the same
            transaction, divided by the pack price. EV &gt; 1 means the
            platform&apos;s house edge is currently negative for that pack.
            Requires NFT-output matching, in progress.
          </p>
        </Section>

        <Section title="Why our numbers may differ from the platform's">
          <ul className="list-disc pl-5 text-[13.5px] leading-relaxed">
            <li>
              <span className="font-semibold text-ink">House-stated odds</span> are
              forward-looking marketing. We measure realized on-chain outcomes
              — a stated 5% Legendary rate may show 3% observed today due to
              variance.
            </li>
            <li>
              <span className="font-semibold text-ink">Off-chain promotions</span>{" "}
              (Stripe-funded campaigns, vouchers, partner deals) aren&apos;t
              visible on-chain. Any gap vs the platform&apos;s own numbers is
              usually here.
            </li>
            <li>
              <span className="font-semibold text-ink">Currency conversion</span> uses
              CoinGecko spot prices snapshotted per warmer run — intra-window
              ETH / SOL moves can shift a USD figure by a few percent.
            </li>
          </ul>
        </Section>

        <Section title="Cache + freshness">
          <p>
            Warmers run on cron (target hourly). Server-rendered pages read
            from disk via <code>unstable_cache</code> with a 1h revalidate
            window. The &quot;Updated Xm ago&quot; badge in each hero reflects
            the oldest underlying snapshot, not render time.
          </p>
        </Section>

        <Section title="Contact / corrections">
          <p>
            If a number looks wrong, tell us. Most discrepancies are
            invalidation lag (cache hasn&apos;t turned over) or scope gaps
            (off-chain activity we can&apos;t see). We add data sources, we
            don&apos;t hand-edit numbers.
          </p>
          <p>
            Reach us directly:{" "}
            <a
              href={X_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-ink transition-colors hover:text-yellow"
            >
              DM @varibletrends on X
            </a>
            .
          </p>
        </Section>

        <div className="mt-16 text-[12px] text-ink-3">
          VARIBLE · methodology · last updated{" "}
          {new Date().toISOString().slice(0, 10)}
        </div>
      </div>
    </>
  );
}

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-20 border-t border-line/60 pt-8">
      <h2 className="mb-3 text-[16px] font-bold tracking-[-0.005em] text-ink">{title}</h2>
      <div className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-ink-2">
        {children}
      </div>
    </section>
  );
}

function SrcLi({ label, chain, source }: { label: string; chain: string; source: string }) {
  return (
    <li className="flex flex-col rounded-lg border border-line/60 bg-bg-1 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-ink">{label}</span>
        <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{chain}</span>
      </div>
      <span className="mt-1 text-[12.5px] text-ink-2">{source}</span>
    </li>
  );
}
