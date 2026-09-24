"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { promotePendingAlertEmail } from "@/lib/watch/alertEmail";
import { Section } from "./Section";
import { SubscribeForm } from "./SubscribeForm";

/**
 * The report's subscribe slot, made aware of the confirm / unsubscribe round-trip.
 * /api/confirm 303-redirects to /report?confirmed=1 and /api/unsubscribe to
 * ?unsubscribed=1 — nothing consumed either, so a reader who had just confirmed
 * still got pitched the signup. This swaps the form for a plain acknowledgment.
 *
 * `?alerts=1` is the third landing: the confirm route sends a reader who
 * confirmed with alerts waiting here, and the panel says what just happened —
 * the watch is live and the manage link is on its way — as one receipt line.
 *
 * The signal is read CLIENT-side (useSearchParams, behind the page's <Suspense>)
 * on purpose: reading searchParams on the SERVER would opt the whole ISR-cached
 * /report page into per-request rendering. The form stays the prerendered default;
 * the acknowledgment resolves on the client for the two redirect landings only.
 */
export function ReportSubscribePanel() {
  const params = useSearchParams();
  const alertsLanding = params.get("alerts") === "1";
  // The confirmation link for an alert landed in THIS browser: the address the
  // sheet parked here is now the reader's to reuse (see alertEmail.ts).
  useEffect(() => {
    if (alertsLanding) promotePendingAlertEmail();
  }, [alertsLanding]);

  if (params.get("confirmed") === "1") {
    return (
      <Section title="Subscription confirmed" flush>
        <div className="px-5 pb-6 pt-2 font-sans sm:px-6" data-report-landing="confirmed">
          <p className="text-[15px] font-medium text-ink">
            <span className="text-yellow">✓</span>{" "}You&apos;re on the list.
          </p>
          <p className="mt-1.5 text-[13px] text-ink-3">
            The next weekly report lands in your inbox on Monday.
          </p>
        </div>
      </Section>
    );
  }

  if (alertsLanding) {
    return (
      <Section title="Alerts confirmed" flush>
        <div className="px-5 pb-6 pt-2 font-sans sm:px-6" data-report-landing="alerts">
          <p className="text-[15px] font-medium text-ink">
            <span className="text-yellow">✓</span>{" "}Your alerts are on.
          </p>
          <p className="mt-1.5 font-mono text-[11.5px] text-ink-3">alerts confirmed · manage link sent</p>
        </div>
      </Section>
    );
  }

  if (params.get("unsubscribed") === "1") {
    return (
      <Section title="Unsubscribed" flush>
        <div className="px-5 pb-6 pt-2 font-sans sm:px-6" data-report-landing="unsubscribed">
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
