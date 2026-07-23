"use client";

import { useSearchParams } from "next/navigation";
import { Section } from "./Section";
import { SubscribeForm } from "./SubscribeForm";

/**
 * The report's subscribe slot, made aware of the confirm / unsubscribe round-trip.
 * /api/confirm 303-redirects to /report?confirmed=1 and /api/unsubscribe to
 * ?unsubscribed=1 — nothing consumed either, so a reader who had just confirmed
 * still got pitched the signup. This swaps the form for a plain acknowledgment.
 *
 * The signal is read CLIENT-side (useSearchParams, behind the page's <Suspense>)
 * on purpose: reading searchParams on the SERVER would opt the whole ISR-cached
 * /report page into per-request rendering. The form stays the prerendered default;
 * the acknowledgment resolves on the client for the two redirect landings only.
 */
export function ReportSubscribePanel() {
  const params = useSearchParams();

  if (params.get("confirmed") === "1") {
    return (
      <Section title="Subscription confirmed" flush>
        <div className="px-5 pb-6 pt-2 font-sans sm:px-6">
          <p className="text-[15px] font-medium text-ink">
            <span className="text-yellow">✓</span> You&apos;re on the list.
          </p>
          <p className="mt-1.5 text-[13px] text-ink-3">
            The next weekly report lands in your inbox on Monday.
          </p>
        </div>
      </Section>
    );
  }

  if (params.get("unsubscribed") === "1") {
    return (
      <Section title="Unsubscribed" flush>
        <div className="px-5 pb-6 pt-2 font-sans sm:px-6">
          <p className="text-[15px] font-medium text-ink">
            You&apos;ve been removed from the weekly report.
          </p>
          <p className="mt-1.5 text-[13px] text-ink-3">No further emails will be sent.</p>
        </div>
      </Section>
    );
  }

  return <SubscribeForm source="report" variant="full" />;
}
