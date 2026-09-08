import { NavBar } from "@/components/NavBar";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { indexRegistry, INDEX_FAMILY, INDEX_FAMILY_SHORT } from "@/lib/indices/naming";
import { X_URL } from "@/lib/site";
import { PLATFORM_SOURCES } from "@/lib/data/sources";

// Static hand-authored content — cache it and revalidate hourly instead of
// re-rendering per request (F8-4).
export const revalidate = 3600;

export const metadata = {
  title: "Methodology · VARIBLE",
  description:
    "How VARIBLE computes market cap, holders, volume, primary revenue, and gacha statistics — every number sourced directly from on-chain data.",
};

export default async function MethodologyPage() {
  return (
    <>
      <NavBar ticker={await buildMarketTicker()} />
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
            We index {PLATFORM_SOURCES.length} platforms directly against their canonical chains.
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
            <SrcLi
              label="DYLI"
              chain="Abstract"
              source="DYLI's own public sales API, read directly. Each sale is classified by its channel: user-to-user resale is marketplace volume, mystery boxes are gacha, and inventory purchases and fair-drop entries are direct sales. eBay-venue rows and zero-price box claims are excluded."
            />
          </ul>
        </Section>

        <Section title="Index naming" id="naming">
          <p>
            Every index we publish belongs to one family:{" "}
            <span className="font-semibold text-ink">{INDEX_FAMILY}</span> (nickname &quot;
            {INDEX_FAMILY_SHORT}&quot;). Each is a constant-quality price index built from repeat
            sales — the same physical card sold in two different weeks, each pair&apos;s move spread
            over the weeks it spans and chained week to week, rebased to 100 at inception. It is a
            trend estimator: smoother than any single week, and a week resting on too few pairs is
            withheld rather than estimated. It replaced a set×grade stratified median that measured
            mix, not price. Each index carries a <code>V-</code> ticker derived from the entity&apos;s short code, so the scheme
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

        <Section title="Platform economics" id="economics">
          <p>
            <strong className="font-semibold text-ink">What the page measures.</strong> Gacha <em>spend</em> is canonical pack-pull
            volume from the spine. <em>Outbound</em> is USDC leaving a platform&apos;s known
            on-chain gacha wallets. Both are summed over the same 30 complete days, so the
            windows and the completeness basis match by construction.
          </p>
          <p>
            <strong className="font-semibold text-ink">Coverage: what a venue must expose.</strong>{" "}
            Each leg of the page is counted per venue, and the four are independent.{" "}
            <em>Spend</em>{" "}
            needs pack pulls recorded against the venue in the spine, which every tracked
            venue has.{" "}
            <em>Outbound</em>{" "}
            needs a known on-chain wallet the venue pays out of, and that wallet&apos;s
            counterparties to be separable well enough that the flow is not dominated by
            non-players — a venue with no such wallet has no outbound figure at all, and one
            whose split is known-wrong has the leg withheld rather than estimated.{" "}
            <em>Players</em>{" "}
            needs row-level pulls carrying a wallet, which is what makes concentration and
            spend tiers computable.{" "}
            <em>Partner attribution</em>{" "}
            needs a partner identifier on the pull itself, which today only one venue&apos;s
            pull memo carries. The coverage matrix on{" "}
            <a href="/economics" className="text-ink-2 underline-offset-2 hover:text-yellow hover:underline">/economics</a>{" "}
            states which venue meets which, and a leg is never inferred from another: a venue
            that publishes spend tells you nothing about whether its payouts can be counted.
          </p>
          <p>
            <strong className="font-semibold text-ink">Rule R3.</strong> A payout counts only if the recipient wallet has itself spent
            into the gacha. R3 tests <em>who</em> the counterparty is — it never tests what a
            transfer was for, so it removes vendors and treasury movement but cannot remove a
            partner settlement to a wallet that also plays. The R3-verified share states how
            much of gross outflow passes that test.
          </p>
          <p>
            <strong className="font-semibold text-ink">Payout ÷ spend.</strong> The ratio of those two legs. Above 100% is not
            automatically an error: when a platform&apos;s spend is falling, payouts settle
            earlier and larger cohorts against a smaller current spend, and the ratio exceeds
            1.0 with nothing miscounted. Reading it as margin requires cohorting payouts to
            the pulls they settle, which is backend work not yet done.
          </p>
          <p>
            <strong className="font-semibold text-ink">Disclosure states, per platform.</strong> <em>Gross</em> — the outbound flow is
            published under a label saying what it is (players and partners, non-player
            counterparties included). <em>Suppressed</em> — nothing is published on the
            outbound side, because that platform&apos;s exclusion list misses its dominant
            non-player counterparties and the resulting rate would be an artifact of the
            omission rather than a business fact. Spend comes from a separate query and is
            unaffected either way.
          </p>
          <p>
            <strong className="font-semibold text-ink">Why net is held.</strong> Net is spend minus R3-counted payouts — a small
            difference of two large numbers, roughly 5% of spend, so a sub-1% error in the
            payout leg is levered about 20× into it, and it errs in the flattering direction
            because a missing spender drops a payout. Four reasons can hold it:{" "}
            <em>unsourced</em> (no on-chain payout wallet exists — nothing to compute),{" "}
            <em>reconciliation</em> (the counting is known-wrong for that platform),{" "}
            <em>awaiting-r3-basis</em> (payout days not yet proven to be on the R3 basis), and{" "}
            <em>spender-coverage</em> (the spender set behind R3 is not yet complete enough;
            it needs about 99% and currently measures lower). A held net is shown as a chip
            carrying its reason, never as a number, and never as a partial market sum that
            silently excludes the platform we can actually count.
          </p>
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
