import Link from "next/link";
import { NavBar } from "@/components/NavBar";

// Static hand-authored content — cache it and revalidate hourly instead of
// re-rendering per request (mirrors /methodology).
export const revalidate = 3600;

export const metadata = {
  title: "Terms of Service · VARIBLE",
  description:
    "The terms on which VARIBLE — a read-only market-data terminal for tokenized collectibles, a Rarible project — provides information. Draft pending legal review.",
};

// Fixed publication date for this draft (see work package). Not derived from
// render time so the stamp stays stable until legal signs off.
const LAST_UPDATED = "2026-07-13";

export default function TermsPage() {
  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[820px] px-8 pt-10 pb-24 font-sans">

        <header className="mb-6">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-3">
            Legal
          </span>
          <h1 className="mt-1.5 text-[20px] font-bold leading-none tracking-[-0.01em]">
            Terms of Service
          </h1>
          <p className="mt-4 max-w-[640px] text-[14px] leading-relaxed text-ink-2">
            VARIBLE is a read-only market-data terminal for tokenized physical
            collectibles, published as a Rarible project. These terms describe
            what the service is, what it is not, and the basis on which the
            information is provided.
          </p>
          <p className="mt-4 text-[12px] text-ink-3">Last updated: {LAST_UPDATED}</p>
        </header>

        <DraftNotice />

        <Section title="What VARIBLE is">
          <p>
            VARIBLE is a market-data website (a &quot;terminal&quot;) for
            tokenized physical collectibles — real graded trading cards held in
            professional vaults and traded as blockchain tokens. It displays
            market statistics and links out to third-party marketplaces.
          </p>
          <p className="mt-3">
            VARIBLE is <span className="font-semibold text-ink">not</span> a
            marketplace, exchange, broker, wallet, or custodian. You cannot buy,
            sell, list, bid, deposit, or connect a wallet on VARIBLE. Core
            features include market-wide statistics (market cap, volume,
            holders), the VARIBLE Index family of price indices, comparisons
            against financial benchmarks, trending and recently-sold cards,
            per-marketplace and per-franchise analytics, gacha (pack-opening)
            statistics, outbound &quot;Buy on X&quot; links, a weekly market
            report, and a read-only JSON API for partners.
          </p>
        </Section>

        <Section title="Not a marketplace, not a party to transactions">
          <p>
            All transactions occur on third-party platforms under those
            platforms&apos; own terms. VARIBLE is not a party to any
            transaction and does not guarantee the listings, prices, or
            availability shown behind &quot;Buy on X&quot; links. Following an
            outbound link takes you to a site VARIBLE does not operate or
            control.
          </p>
        </Section>

        <Section title="Informational only — not financial advice">
          <p>
            Everything on VARIBLE is provided for informational purposes only
            and is not investment, financial, legal, or tax advice. Indices,
            expected-value figures, momentum and trend metrics, and similar
            derived numbers are statistical derivations, not predictions and not
            investment signals. You are solely responsible for your own
            decisions.
          </p>
          <Flag>
            The footer already carries a short version of this disclaimer; the
            brief asks that a formal warranty disclaimer and limitation of
            liability be drafted by counsel. The language above is a
            plain-language placeholder, not finalized legal text.
          </Flag>
        </Section>

        <Section title="Data accuracy and reliance">
          <p>
            Numbers on VARIBLE are best-efforts estimates derived from public
            blockchain data, marketplace platform APIs, and financial-benchmark
            feeds. The methodology behind every metric is published on the{" "}
            <Link href="/methodology" className="text-ink underline underline-offset-2 hover:text-yellow">
              methodology page
            </Link>
            , and a live{" "}
            <Link href="/status" className="text-ink underline underline-offset-2 hover:text-yellow">
              data-status page
            </Link>{" "}
            shows per-feed freshness and errors. Estimates are flagged as such,
            and where clean data is insufficient VARIBLE displays
            &quot;insufficient data&quot; rather than a number.
          </p>
          <p className="mt-3">
            Despite these controls, figures can be wrong, delayed, or
            incomplete, and reported volumes are floors, not ceilings. To the
            extent permitted by applicable law, VARIBLE accepts no liability for
            decisions made on the basis of the information shown. If a number
            looks wrong, corrections currently route through the methodology
            page.
          </p>
        </Section>

        <Section title="A free service">
          <p>
            The site is entirely free. There are no payments, subscriptions,
            paywalls, or in-app purchases, and VARIBLE holds no user funds.
          </p>
          <p className="mt-3">
            &quot;Buy on X&quot; links are plain outbound hyperlinks to
            third-party marketplaces. No affiliate or referral fees are
            collected — the links are pure redirection. If affiliate terms are
            ever introduced, these terms will be amended with a compensation
            disclosure first.
          </p>
        </Section>

        <Section title="Gacha and expected-value content">
          <p>
            VARIBLE displays gacha statistics for randomized paid products,
            including platforms&apos; stated odds and VARIBLE&apos;s own
            observed-odds and expected-value estimates (labeled with sample
            sizes). VARIBLE does not operate, sell, or take part in any gacha or
            pack-opening product; it only reports on-chain observations of them.
          </p>
          <Flag>
            Gacha content is gambling-adjacent. Counsel should review the framing
            of odds and expected-value figures for gambling-promotion
            sensitivities by jurisdiction, and advise whether an age or
            jurisdiction note is warranted. No such gating is asserted here.
          </Flag>
        </Section>

        <Section title="Third-party intellectual property">
          <p>
            Franchise names and trademarks (for example Pokémon, One Piece,
            Yu-Gi-Oh!, Disney Lorcana, and sports leagues and players) are used
            nominatively to identify the physical cards being tracked, as price
            guides and marketplaces do. Platform names and logos are used for
            identification only. Benchmark names such as &quot;S&amp;P 500&quot;
            and &quot;NASDAQ&quot; are referenced descriptively as comparison
            data. No sponsorship, endorsement, affiliation, or partnership is
            claimed or implied except where one actually exists.
          </p>
          <p className="mt-3">
            Card images are photographs or scans of trademarked, copyrighted
            cards, sourced from the listing platforms and chain storage and
            re-served through VARIBLE&apos;s host-allowlisted image proxy.
          </p>
          <Flag>
            Counsel to finalize the nominative-use and no-affiliation language,
            confirm descriptive use of trademarked benchmark names, assess the
            image display and proxy-caching posture, and provide a DMCA / notice-
            and-takedown contact (none is specified in the brief).
          </Flag>
        </Section>

        <Section title="Third-party links and sites">
          <p>
            VARIBLE links out to third-party marketplaces and sources. VARIBLE
            does not control those destination sites and is not responsible for
            their content, terms, availability, or the transactions conducted on
            them.
          </p>
        </Section>

        <Section title="The public API">
          <p>
            A read-only JSON API exists in the codebase but is dormant at launch:
            no keys have been issued, and without a key every request is
            rejected. An attribution requirement ships inside every API response.
            If and when partner access begins, keys will be issued under written
            terms and formal API terms will be published; no consumer data is
            involved either way.
          </p>
        </Section>

        <Section title="Affiliation with Rarible">
          <p>
            VARIBLE is a Rarible project, as stated in the site footer. Despite
            that affiliation, VARIBLE&apos;s market data does not come from
            Rarible&apos;s APIs. Where an item is available on Rarible, Rarible
            may be listed first among buy-links — a design choice by a Rarible
            project.
          </p>
          <Flag>
            Whether a formal affiliation disclosure is required, and how it
            should read, is counsel&apos;s call.
          </Flag>
        </Section>

        <Section title="Items pending legal review">
          <p>
            The following are open in the source brief and must be supplied or
            confirmed by counsel before these terms are final. They are not yet
            addressed above:
          </p>
          <ul className="mt-3 list-disc pl-5 text-[13.5px] leading-relaxed">
            <li>
              The operating entity behind VARIBLE, and whether these are
              standalone VARIBLE terms or a supplement to Rarible&apos;s
              existing Terms.
            </li>
            <li>Governing law, jurisdiction, and dispute-resolution terms.</li>
            <li>
              Formal warranty disclaimer, limitation-of-liability, and
              indemnity language.
            </li>
            <li>
              A DMCA / notice-and-takedown agent and contact for card-image
              complaints.
            </li>
            <li>
              Any jurisdictional gating or age note for gacha / expected-value
              content.
            </li>
            <li>
              The platform-API posture (read-only access to observed,
              undocumented endpoints) and any ToS or CFAA-style exposure.
            </li>
            <li>
              Benchmark redistribution terms (CoinGecko, FRED) for displayed and
              API-served benchmark series.
            </li>
            <li>
              A formal mechanism and notice terms for changes to these terms.
            </li>
          </ul>
        </Section>

        <div className="mt-16 text-[12px] text-ink-3">
          VARIBLE · terms of service · draft, last updated {LAST_UPDATED}
        </div>
      </div>
    </>
  );
}

function DraftNotice() {
  return (
    <div className="mt-2 rounded-lg border border-line/60 border-l-2 border-l-yellow bg-bg-1 px-4 py-3.5 text-[12.5px] leading-relaxed text-ink-2">
      <span className="font-semibold text-ink">Draft — pending legal review.</span>{" "}
      This page is a plain-language draft assembled from an internal platform
      briefing that describes how VARIBLE works. It has not been reviewed or
      approved by legal counsel and is not a binding agreement. Items marked{" "}
      <span className="font-semibold uppercase tracking-[0.08em] text-yellow">
        Legal review
      </span>{" "}
      below, and the list of open items at the end, are unresolved and must be
      completed by counsel before publication.
    </div>
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

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex flex-col gap-1 rounded-md border border-line/60 bg-bg-2 px-3 py-2.5 text-[12px] leading-relaxed text-ink-3 sm:flex-row sm:gap-2.5">
      <span className="shrink-0 font-semibold uppercase tracking-[0.08em] text-yellow">
        Legal review
      </span>
      <span>{children}</span>
    </p>
  );
}
