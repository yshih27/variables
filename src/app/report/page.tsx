import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { Section } from "@/components/Section";
import { ReportView } from "@/components/ReportView";
import { SubscribeForm } from "@/components/SubscribeForm";
import { readWeeklyReport } from "@/lib/data/weeklyReport";

// ISR: the report is written weekly (Monday cron, B9-2); hourly revalidate picks
// up the fresh snapshot without re-rendering per request.
export const revalidate = 3600;

export const metadata = {
  title: "Weekly Report · VARIABLE",
  description:
    "The tokenized-collectibles market, week over week: price-index performance vs benchmarks, top movers, biggest sales, and notable pulls — every figure from on-chain reads.",
};

function fmtAsOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function ReportPage() {
  const report = await readWeeklyReport();

  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[1760px] px-8 pb-24 pt-8">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
          <Link href="/" className="hover:text-ink-2">
            Rankings
          </Link>
          <span>›</span>
          <span className="text-ink-2">Weekly Report</span>
        </div>

        <header className="mb-8">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-3">
            The market, weekly
          </span>
          <h1 className="mt-2 font-sans text-[38px] font-bold leading-[1.05] tracking-[-0.02em]">
            Weekly Report
          </h1>
          {report ? (
            <p className="mt-3 text-[13px] text-ink-3">As of {fmtAsOf(report.generatedAt)}</p>
          ) : null}
        </header>

        {report ? <ReportView report={report} /> : <EmptyState />}

        <div className="mx-auto mt-10 max-w-[720px]">
          <SubscribeForm source="report" variant="full" />
        </div>
      </div>
    </>
  );
}

// TODO(design-r1 Q4): replace with the official Variable X handle once confirmed.
// Stubbed to /variable so the CTA is wired; flagged in the PR summary.
const X_URL = "https://x.com/variable";

/** The X (formerly Twitter) brand mark — a brand logo, kept monochrome. */
function XGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** Honest state until the backend B9-2 composer writes the first snapshot. */
function EmptyState() {
  return (
    <Section title="The first weekly report is being prepared" flush>
      <div className="flex flex-col gap-5 px-5 py-8 font-sans sm:px-6">
        <p className="max-w-[620px] text-[14px] leading-relaxed text-ink-2">
          Every Monday, VARIABLE publishes a shareable snapshot of the tokenized-collectibles
          market. Once the first one is composed it will land right here. Each report covers:
        </p>
        <ul className="flex flex-col gap-2 text-[13.5px] text-ink-2">
          <li>· Price-index performance, week over week (plus 30- and 90-day)</li>
          <li>· Relative strength vs BTC, ETH, S&amp;P 500, NASDAQ and gold</li>
          <li>· The week&apos;s top gaining and falling IPs, platforms and sets</li>
          <li>· Biggest single sales and most notable gacha pulls</li>
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center rounded-lg bg-yellow px-4 py-2 text-[13px] font-semibold text-black transition-opacity hover:opacity-90"
          >
            Explore the live market →
          </Link>
          <a
            href={X_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
          >
            <XGlyph />
            Follow on X
          </a>
        </div>
      </div>
    </Section>
  );
}
