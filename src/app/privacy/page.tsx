import Link from "next/link";
import { NavBar } from "@/components/NavBar";

// Static hand-authored content — cache it and revalidate hourly instead of
// re-rendering per request (mirrors /methodology).
export const revalidate = 3600;

export const metadata = {
  title: "Privacy Policy · VARIABLE",
  description:
    "What data VARIABLE does and does not collect: no accounts, a local-only watchlist, cookieless and GA4 analytics, and weekly-report email signup. Draft pending legal review.",
};

// Fixed publication date for this draft (see work package). Not derived from
// render time so the stamp stays stable until legal signs off.
const LAST_UPDATED = "2026-07-13";

export default function PrivacyPage() {
  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[820px] px-8 pt-10 pb-24 font-sans">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
          <Link href="/" className="hover:text-ink-2">Rankings</Link>
          <span>›</span>
          <span className="text-ink-2">Privacy Policy</span>
        </div>

        <header className="mb-8">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-3">
            Legal
          </span>
          <h1 className="mt-2 text-[44px] font-bold leading-[1.05] tracking-[-0.02em]">
            Privacy Policy
          </h1>
          <p className="mt-4 max-w-[640px] text-[14px] leading-relaxed text-ink-2">
            VARIABLE is a read-only market-data terminal with no accounts and no
            login. This page describes the limited data the site collects, why,
            and what it is never used for.
          </p>
          <p className="mt-4 text-[12px] text-ink-3">Last updated: {LAST_UPDATED}</p>
        </header>

        <DraftNotice />

        <Section title="No accounts, no wallet">
          <p>
            There are no accounts, no login, and no wallet connection on
            VARIABLE. There is nothing to sign up for in order to browse the
            site, and VARIABLE holds no user funds.
          </p>
        </Section>

        <Section title="Your watchlist stays in your browser">
          <p>
            The watchlist is stored only in your browser&apos;s localStorage. It
            is never transmitted to or stored by VARIABLE. Clearing your
            browser&apos;s storage clears your watchlist.
          </p>
        </Section>

        <Section title="Analytics">
          <p>Two analytics services are used at launch:</p>
          <ul className="mt-3 list-disc pl-5 text-[13.5px] leading-relaxed">
            <li>
              <span className="font-semibold text-ink">Vercel Web Analytics</span>{" "}
              — cookieless and aggregate (page views, referrers, countries, and
              performance).
            </li>
            <li>
              <span className="font-semibold text-ink">Google Analytics 4</span>{" "}
              — added at the company&apos;s direction. GA4 sets cookies and
              device identifiers and transmits usage data to Google, which acts
              as a processor.
            </li>
          </ul>
          <p className="mt-3">
            There are no other tracking SDKs — no Meta pixel and no Sentry. Aside
            from GA4&apos;s, no cookies are set by VARIABLE&apos;s own code.
          </p>
          <Flag>
            Counsel must advise on the cookie-consent banner requirement for EU,
            UK, and other visitors, acceptance of Google&apos;s data-processing
            terms, IP-handling settings, consent-mode defaults, and how both
            services are named here. Until advised otherwise, GA4 is to be
            configured with consent-mode defaults appropriate to the target
            jurisdictions.
          </Flag>
        </Section>

        <Section title="Server logs">
          <p>
            Standard hosting logs (Vercel) record IP addresses in transient
            infrastructure logs. VARIABLE does not use these to build user
            profiles.
          </p>
        </Section>

        <Section title="Email signup for the weekly report">
          <p>
            You may submit an email address to receive the weekly market report.
            When you do, VARIABLE stores your email address, a consent timestamp,
            the signup source, and an unsubscribe token.
          </p>
          <p className="mt-3">
            This information is used solely to send the weekly report. Every
            email carries one-click unsubscribe. Your email address is never sold
            or shared. (Report sending begins after launch; collection starts at
            launch.)
          </p>
          <Flag>
            Counsel to confirm the lawful basis and consent wording, the
            unsubscribe mechanics, and the retention period. The brief leaves
            retention open, with a proposal to delete the record on unsubscribe.
          </Flag>
        </Section>

        <Section title="The public API">
          <p>
            A read-only JSON API exists in the codebase but is dormant at launch:
            no keys have been issued, and every request without a key is
            rejected. No consumer personal data is involved either way.
          </p>
        </Section>

        <Section title="What VARIABLE never does">
          <ul className="list-disc pl-5 text-[13.5px] leading-relaxed">
            <li>Sell or share your email or other personal data.</li>
            <li>Transmit or store your watchlist on its servers.</li>
            <li>Build user profiles from server logs.</li>
            <li>
              Run tracking beyond the two analytics services named above.
            </li>
          </ul>
        </Section>

        <Section title="Contact and corrections">
          <p>
            Questions about the data or a wrong number currently route through
            the{" "}
            <Link href="/methodology" className="text-ink underline underline-offset-2 hover:text-yellow">
              methodology page
            </Link>
            . A dedicated privacy and data-rights contact is an open item below.
          </p>
        </Section>

        <Section title="Items pending legal review">
          <p>
            The following are open in the source brief and must be supplied or
            confirmed by counsel before this policy is final. They are not yet
            addressed above:
          </p>
          <ul className="mt-3 list-disc pl-5 text-[13.5px] leading-relaxed">
            <li>
              The data controller / operating entity, and whether this is a
              standalone policy or a supplement to Rarible&apos;s existing
              Privacy Policy.
            </li>
            <li>
              Applicable privacy law and the data-subject rights it grants, plus
              how to exercise them and a contact to do so.
            </li>
            <li>
              Cookie-consent mechanics and GA4 configuration for the target
              jurisdictions (see Analytics above).
            </li>
            <li>The email-signup retention period.</li>
            <li>
              International data-transfer basis for data processed by Vercel and
              Google.
            </li>
            <li>Any children&apos;s-data or minimum-age statement.</li>
          </ul>
        </Section>

        <div className="mt-16 text-[12px] text-ink-3">
          VARIABLE · privacy policy · draft, last updated {LAST_UPDATED}
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
      briefing that describes how VARIABLE handles data. It has not been reviewed
      or approved by legal counsel. Items marked{" "}
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
      <h2 className="mb-3 text-[20px] font-semibold tracking-[-0.005em]">{title}</h2>
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
