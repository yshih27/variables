import { NavBar } from "@/components/NavBar";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { indexRegistry, INDEX_FAMILY, INDEX_FAMILY_SHORT, INDEX_DESCRIPTOR, indexReceipt } from "@/lib/indices/naming";
import { readIndexMeta, readIndexSeries, completeMonthsOnly } from "@/lib/data/indices";
import { formatMonthDayUtc } from "@/lib/format";
import { X_URL } from "@/lib/site";
import { PLATFORM_SOURCES, type PlatformSource } from "@/lib/data/sources";
import { readMethodChanges, type MethodLedger } from "@/lib/data/methodChanges";
import { labelFor } from "@/lib/indices/entityLabels";
import { receiptsHref } from "@/lib/indices/receiptRoute";
import Link from "next/link";
import { Fragment } from "react";

// Static hand-authored content — cache it and revalidate hourly instead of
// re-rendering per request (F8-4).
export const revalidate = 3600;

export const metadata = {
  title: "Methodology · VARIBLE",
  description:
    "How VARIBLE computes market cap, holders, volume, primary spend and the Varible Index — every figure traced to a named feed and its window, and withheld when it cannot be.",
};

export default async function MethodologyPage() {
  // The method ledger, for the "Method changes" section below. Absent when the
  // snapshot has no records — see MethodChangesSection.
  const ledger = await readMethodChanges();
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
            Every number on VARIBLE traces to a named feed: a chain read, a
            venue&apos;s own order feed, or an index of on-chain trades. Where a
            figure rests on an aggregator, the surface that shows it says so in a
            receipt line; where a venue publishes nothing we can verify, the figure
            is withheld rather than estimated. This page documents the source and
            the formula behind every metric so you can audit our numbers.
          </p>
        </header>

        <Section title="Sources">
          <p>
            We track {PLATFORM_SOURCES.length} venues across{" "}
            {new Set(PLATFORM_SOURCES.map((p) => p.chain)).size} chains. Each is read leg by
            leg: resale, listings, holders and card data, and primary spend. A leg with no
            defensible source is listed as withheld, not filled in. Every metric on the site
            flows from one of these reads:
          </p>
          <VenueSources />
        </Section>

        <Section title="Index naming" id="naming">
          <p>
            Every index we publish belongs to one family:{" "}
            <span className="font-semibold text-ink">{INDEX_FAMILY}</span>{" "}(nickname &quot;
            {INDEX_FAMILY_SHORT}&quot;). Each is a <span className="text-ink">{INDEX_DESCRIPTOR}</span>:
            the realised resale price of the same card <em>identity</em>{" "}— set, number, name and
            grade, with edition and language when the platform carries them — priced in
            consecutive calendar months. An identity&apos;s monthly price is the median of its
            sales that month, and it only counts with two or more sales (one sale is a quote,
            not a price). Each month&apos;s step is the weighted median of the log change across
            identities priced in both that month and the one before, weighted by the smaller of
            the two sale counts, and the level chains those steps from 100 at inception. A month
            with fewer than 20 such identities for the market or a category, or 10 for a single
            IP, is withheld: the chain does not advance through it, and the next published point
            says how many months it spans. The band on every point is a bootstrap over
            identities, and it widens with distance from the base, as a chained index&apos;s
            uncertainty should. Each index carries a <code>V-</code>{" "}ticker derived from the
            entity&apos;s short code, so the scheme never drifts as the catalog grows. The whole
            market is <code>V-MKT</code>; each category and named IP has its own. The public API
            echoes each index&apos;s ticker, which makes this registry the canonical one.
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

        <Section title="What the index follows, and what it does not" id="index-bias">
          <p>
            The index follows what actually <em>resells</em>. That is the only constant-quality
            comparison the market offers, and it carries a known tilt: sellers relist what they
            can flip, so short-interval resales run hotter than long ones. We measure that tilt on
            every rebuild as the holding-period spread — the per-month rate of identities observed
            one month apart minus the rate of those observed two to three months apart — and print
            it beside the level as the <span className="font-mono text-ink">resale skew</span>.
            Beside it sits the <span className="font-mono text-ink">cap anchor</span>: the change
            in tracked market cap over the same span, an independent reading of the whole market
            rather than its resales. The gap between the two is the premium, made visible.
          </p>
          <p className="mt-2">
            If the skew widens past three points a month the builder withholds the series
            automatically and every surface prints the same sentence saying so; it republishes
            when the next rebuild measures it back inside the limit. The manual hold used during
            the method rebuild is a separate switch and stays available. This paragraph is the
            anchor the ⓘ beside every index level opens.
          </p>
          <IndexBiasReceipt />
        </Section>

        <MethodChangesSection ledger={ledger} />

        <Section title="Market Cap">
          <p>
            Per-token value is the cheapest active USD listing on the
            platform&apos;s order book. For Collector Crypt we use the{" "}
            <em>Insured Value</em>{" "}trait (PWCC vault appraisal) since most CC
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
            from each venue&apos;s resale feed listed under Sources: Beezie&apos;s own order
            feed, Rarible&apos;s index of Courtyard&apos;s on-chain trades, the Dune query
            over the Collector Crypt marketplace program, and DYLI&apos;s resale lane.
            Every feed passes the same hygiene before it is counted: exact-duplicate
            rows, self-trades, wallet-pair ring washes and one-seller bulk sweeps are
            dropped. Phygitals&apos; resale market has no source yet, so its resale
            figures read <code>—</code> rather than zero.
          </p>
          <p className="mt-3">
            <span className="font-semibold text-ink">Active 24h</span> = the
            union of unique buyer + seller wallets (set union, not sum). Same
            wallet on both sides counts once.
          </p>
        </Section>

        <Section title="Primary Revenue (Gacha + Tokenization)">
          <p>
            For each venue with a primary-market mechanic, spend is read daily
            through Dune as USDC paid into the venue&apos;s receiving wallets; a
            wallet-level scan of the same transfers stands behind it as the fallback:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-line/60 bg-bg-1 p-4 text-[12px] leading-relaxed text-ink-2">
{`primary_revenue = Σ ( USDC inflow into platform.gacha_receivers
                      from senders NOT in platform.internal_exclusions )

For Collector Crypt: only transfers at a published pull price [${ccPullLadder()}]
For Phygitals: every inbound transfer above dust, treasury excluded as a sender
For Courtyard and the Claw: every inbound transfer.`}
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
            volume from the spine. <em>Outbound</em>{" "}is USDC leaving a platform&apos;s known
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
            <strong className="font-semibold text-ink">Payout ÷ spend.</strong>{" "}The ratio of those two legs. Above 100% is not
            automatically an error: when a platform&apos;s spend is falling, payouts settle
            earlier and larger cohorts against a smaller current spend, and the ratio exceeds
            1.0 with nothing miscounted. Reading it as margin requires cohorting payouts to
            the pulls they settle, which is backend work not yet done.
          </p>
          <p>
            <strong className="font-semibold text-ink">Disclosure states, per platform.</strong> <em>Gross</em> — the outbound flow is
            published under a label saying what it is (players and partners, non-player
            counterparties included). <em>Suppressed</em>{" "}— nothing is published on the
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
            Warmers run on a fixed schedule and write snapshots; pages read the
            newest snapshot and revalidate on a fixed window, so a figure can trail
            its source by up to that window. Per-feed freshness, with the last time
            each source actually succeeded rather than when a page rendered, is on{" "}
            <Link href="/status" className="text-ink-2 underline-offset-2 hover:text-yellow hover:underline">
              /status
            </Link>
            .
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

/** The four legs every venue is read by, in the order the cards print them. */
type VenueLegs = { resale: string; listings: string; holders: string; primary: string };
const LEG_LABELS: [keyof VenueLegs, string][] = [
  ["resale", "Resale"],
  ["listings", "Listings"],
  ["holders", "Holders"],
  ["primary", "Primary"],
];

/**
 * How each venue is read, leg by leg — the prose for the Sources section.
 *
 * ⚠️ KEYED ON THE REGISTRY, DELIBERATELY. Names, chains and order come from
 * PLATFORM_SOURCES; a venue added there without an entry here fails to compile,
 * so this copy cannot drift from the code silently. It did: the section kept
 * saying Courtyard was read from its own contract after #149 moved it to
 * Rarible's activity index. When a reader changes (core.ts, warm-listings,
 * warm-holders, the Dune SQL), change the leg here in the same PR.
 */
const VENUE_LEGS: Record<PlatformSource["key"], VenueLegs> = {
  courtyard: {
    resale:
      "Rarible's activity index for the Courtyard collection, which is where the collection's on-chain trades on Polygon are indexed; read live over a rolling window and passed through the same hygiene as every feed. Courtyard's own in-app marketplace settles off-chain and is visible to no source. The Dune query this leg replaced decoded the same trades a day late; it is retired and kept for the provenance of older points.",
    listings:
      "Rarible's active sell orders for the collection, cheapest ask per token, dust excluded; capped per run, since Courtyard's book is by far the largest we read.",
    holders:
      "Not indexed. Courtyard's per-card data is not yet in our card table, so it has no holder count, no per-card identity and no market cap; each reads as withheld, never as zero.",
    primary:
      "Pack spend: USDC paid into Courtyard's receiving wallets on Polygon, read daily through Dune and published as gacha volume, with an Etherscan read of the same transfers as the fallback. Tokenization fees are paid off-chain and are not counted.",
  },
  beezie: {
    resale:
      "Beezie's own order feed, read directly from its API: each fulfilled order is a sale, and the feed reaches back months, so every window is read in full. Not read through an aggregator.",
    listings:
      "Rarible's active sell orders for the collection, cheapest ask per token. An aggregator ask can be a placeholder, so an identity page prints a Beezie ask as the floor only when it sits within a set band of that card's monthly price; otherwise it is a receipt line marked unverified, never a headline.",
    holders:
      "Ownership from Rarible's ownership index for the collection; card metadata from each token's URI on Base, persisted the first time a token is seen.",
    primary:
      "The Claw: USDC paid into the Claw contract on Base, read daily through Dune, with an Etherscan read of the same transfers as the fallback. The Claw's catalog, stated odds and prize pool come from Beezie's own endpoint and are labelled as stated by the venue, never as realized.",
  },
  "collector-crypt": {
    resale:
      "A Dune query over the Collector Crypt marketplace program: one sale per transaction that moves both an NFT and USDC, priced at the largest USDC transfer in it, over a rolling window. Bids that never settle are excluded by construction.",
    listings: "Collector Crypt's own marketplace API, cheapest ask per card.",
    holders:
      "Helius DAS over the collection: owner, traits and the Insured Value appraisal that prices its market cap.",
    primary:
      "Pack pulls: USDC paid into the gacha wallets at a price on the published pull ladder, house and rarity-bucket wallets excluded as senders, read daily through Dune. Each pull's prize comes from the gacha app's own winners feed, captured continuously. Buyback is USDC returned from those wallets to players who had spent in, under rule R3 below.",
  },
  phygitals: {
    resale:
      "No source. Its sales API carries pack pulls only, and its resale trades settle on Tensor and Magic Eden, which need a query of their own; resale figures are withheld until one exists.",
    listings:
      "Phygitals' own marketplace API, which already aggregates Tensor, Magic Eden and native asks; cheapest per card.",
    holders:
      "Helius DAS over its two compressed-NFT collections. No per-card valuation exists, so its market cap is floor times supply, at venue level only, and stays out of the cross-venue total.",
    primary:
      "Pack pulls: USDC paid into its gacha wallets, treasury excluded as a sender and dust excluded, read daily through Dune; realized pulls from its own pull feed. Buyback under rule R3, as for Collector Crypt.",
  },
  dyli: {
    resale:
      "DYLI's own public sales API, read directly. Each sale is classified by its channel, and only user-to-user resale is marketplace volume.",
    listings: "Its public listings endpoint: the floor, and a market cap of cheapest ask times units available.",
    holders: "Not counted; no ownership read is wired for its inventory contract.",
    primary:
      "From the same sales feed: mystery boxes are gacha, inventory purchases and fair-drop entries are direct sales. eBay-venue rows and zero-price box claims are excluded.",
  },
};

function VenueSources() {
  return (
    <ul className="mt-3 flex flex-col gap-2 text-[13.5px]">
      {PLATFORM_SOURCES.map((p) => (
        <li key={p.key} className="rounded-lg border border-line/60 bg-bg-1 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold text-ink">{p.name}</span>
            <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{p.chain}</span>
          </div>
          <dl className="mt-2 grid grid-cols-[64px_1fr] gap-x-3 gap-y-1.5 text-[12.5px] leading-relaxed">
            {LEG_LABELS.map(([leg, label]) => (
              <Fragment key={leg}>
                <dt className="pt-[3px] text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-3">{label}</dt>
                <dd className="text-ink-2">{VENUE_LEGS[p.key][leg]}</dd>
              </Fragment>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}

/** Collector Crypt's pull-price ladder, from the registry — never typed here. */
function ccPullLadder(): string {
  const ladder = PLATFORM_SOURCES.find((p) => p.key === "collector-crypt")?.primary?.validAmounts ?? [];
  return ladder.map((v) => `$${v.toLocaleString("en-US")}`).join(", ");
}

/**
 * The live receipt, on the page that explains it — every clause from the blob.
 * Renders nothing when the index is held or the blob carries no meta, so the
 * paragraph above never sits next to a number that is not currently published.
 */
async function IndexBiasReceipt() {
  const [meta, series] = await Promise.all([
    readIndexMeta("market", "total").catch(() => null),
    readIndexSeries("market", "total", { kind: "price", from: "2000-01-01" }).catch(() => []),
  ]);
  const complete = completeMonthsOnly(series);
  if (!meta || !complete.length) return null;
  const latest = complete[complete.length - 1];
  const line = indexReceipt({
    latestMonthEnd: formatMonthDayUtc(latest.ts),
    skewPP: meta.selectionPremiumPP,
    anchorPct: meta.anchorPct,
    anchorSince: meta.anchorSince,
  });
  return (
    <p className="mt-3 border-l-2 border-line pl-3 font-mono text-[11.5px] leading-snug text-ink-3">
      V-MKT {latest.value.toFixed(1)} · {line}
    </p>
  );
}

/**
 * Method changes — what a re-key did to the published levels, from the ledger.
 *
 * ⚠️ EVERY NUMBER IS MEASURED, NOT TYPED. The `method-changes` snapshot is
 * written by the SHADOW build (the only run that holds both keyings), so the
 * before/after here is what the two methods actually produced on the same
 * panel — and each month links to its own receipt so a reader can go from
 * "the level moved 0.3" to the cards that moved it.
 *
 * ⚠️ NO RECORDS, NO SECTION. Not a placeholder, not "no changes yet": until a
 * cutover run writes the snapshot, this page says nothing about method changes,
 * which is the honest state for a site whose index has had one method.
 */
function MethodChangesSection({ ledger }: { ledger: MethodLedger }) {
  if (!ledger.changes.length) return null;
  return (
    <Section title="Method changes" id="method-changes">
      {ledger.changes.map((c) => {
        const moved = c.entities.filter(
          (e) => e.levelBefore != null && e.levelAfter != null && Math.abs(e.levelAfter - e.levelBefore) >= 0.05,
        );
        return (
          <div key={`${c.version}:${c.date}`} className="flex flex-col gap-2">
            <p>
              <span className="font-mono text-ink">{c.version}</span>
              <span className="text-ink-3"> · {c.date.slice(0, 10)}</span>
            </p>
            <p>{c.summary}</p>
            {c.entities.length === 0 ? (
              <p className="text-ink-3">No published month changed level under this method.</p>
            ) : (
              <>
                <div className="scroll-x mt-1 rounded-xl border border-line bg-bg-1">
                  <table className="w-full min-w-[520px] border-collapse text-left text-[12.5px]">
                    <thead>
                      <tr className="border-b border-line text-[10.5px] uppercase tracking-[0.07em] text-ink-4">
                        <th scope="col" className="py-2 pl-4 pr-3 font-medium">Index</th>
                        <th scope="col" className="px-3 py-2 font-medium">Month</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Level</th>
                        <th scope="col" className="py-2 pl-3 pr-4 text-right font-medium">Identities</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(moved.length ? moved : c.entities).slice(0, 24).map((e) => {
                        const label = labelFor(e.id);
                        const month = e.month.slice(0, 7);
                        return (
                          <tr key={`${e.id}:${e.month}`} className="border-b border-line/60 last:border-0">
                            <th scope="row" className="py-2 pl-4 pr-3 text-left font-normal text-ink">
                              {label.name}
                            </th>
                            <td className="px-3 py-2 tabular text-ink-2">
                              <Link href={receiptsHref(e.id, month)} className="underline-offset-2 hover:text-yellow hover:underline">
                                {month}
                              </Link>
                            </td>
                            <td className="px-3 py-2 text-right tabular">
                              <span className="text-ink-3">{e.levelBefore?.toFixed(1) ?? "—"}</span>
                              <span className="text-ink-4"> → </span>
                              <span className="text-ink">{e.levelAfter?.toFixed(1) ?? "—"}</span>
                            </td>
                            <td className="py-2 pl-3 pr-4 text-right tabular text-ink-2">
                              {e.identitiesBefore ?? "—"} → {e.identitiesAfter ?? "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="font-mono text-[11px] text-ink-4">
                  {moved.length
                    ? `${moved.length} of ${c.entities.length} published months moved by 0.05 or more; the rest are unchanged.`
                    : `no published month moved by 0.05 or more — ${c.entities.length} months compared.`}{" "}
                  Every month links to the cards behind its step.
                </p>
              </>
            )}
          </div>
        );
      })}
    </Section>
  );
}
