"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Section } from "./Section";

/** Client-side shape check only — the API does the authoritative validation. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status = "idle" | "loading" | "success" | "error";

/**
 * Weekly-report email signup (GTM launch). Two looks from one component:
 *   • variant="full" — Section-framed hero on /report ("Get this report every Monday").
 *   • variant="slim" — compact inline row for the site-wide footer.
 *
 * Posts { email, source, website } to POST /api/subscribe (frozen contract; the
 * backend implements it in parallel). `website` is a honeypot — a hidden field
 * real users never see; a filled value means a bot, so we no-op with a success
 * face rather than tipping it off. Client email validation + loading / success /
 * error states; brand yellow CTA (black text).
 */
export function SubscribeForm({
  source,
  variant = "full",
}: {
  /** Where the signup lives — sent for attribution (e.g. "report", "footer"). */
  source: string;
  variant?: "full" | "slim";
}) {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "loading") return;

    // Honeypot tripped → a bot filled a field humans can't see. Show the success
    // face and send nothing, so it can't tell it was caught.
    if (website.trim()) {
      setStatus("success");
      return;
    }

    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError("Enter a valid email address.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value, source, website }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("success");
    } catch {
      setError("Couldn't sign you up. Please try again.");
      setStatus("error");
    }
  }

  const slim = variant === "slim";

  const honeypot = (
    // Off-screen + non-focusable + no autofill: invisible to people, catnip to bots.
    <div aria-hidden className="pointer-events-none absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden">
      <label>
        Website
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </label>
    </div>
  );

  const consent = (
    <Link
      href="/privacy"
      className={`text-ink-4 underline-offset-2 transition-colors hover:text-ink-2 hover:underline ${slim ? "text-[11px]" : "text-[12px]"}`}
    >
      Weekly report only. Unsubscribe anytime.
    </Link>
  );

  const successNode = (
    <p aria-live="polite" className={`font-sans font-medium text-ink ${slim ? "text-[13px]" : "text-[15px]"}`}>
      <span className="text-yellow">✓</span> You&apos;re on the list.
    </p>
  );

  const onInput = (v: string) => {
    setEmail(v);
    if (status === "error") setStatus("idle");
  };

  // ── SLIM (footer) ──
  if (slim) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-ink-2">Get the weekly report</span>
        {status === "success" ? (
          successNode
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-1.5">
            {honeypot}
            <div className="flex gap-2">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                aria-label="Email address"
                placeholder="you@email.com"
                value={email}
                onChange={(e) => onInput(e.target.value)}
                disabled={status === "loading"}
                className="h-9 w-full min-w-0 rounded-lg border border-line bg-bg-1 px-3 text-[13px] text-ink outline-none placeholder:text-ink-4 focus:border-yellow/60 sm:w-[220px]"
              />
              <button
                type="submit"
                disabled={status === "loading"}
                className="h-9 shrink-0 rounded-lg bg-yellow px-3.5 text-[12.5px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {status === "loading" ? "…" : "Subscribe"}
              </button>
            </div>
            {status === "error" && error && (
              <p role="alert" className="text-[11px] text-red">
                {error}
              </p>
            )}
            {consent}
          </form>
        )}
      </div>
    );
  }

  // ── FULL (report) ──
  return (
    <Section
      title="Get this report every Monday"
      subtitle="The market, distilled — in your inbox to start the week."
      flush
    >
      <div className="px-5 pb-6 pt-2 font-sans sm:px-6">
        {status === "success" ? (
          <div className="flex flex-col gap-1.5 py-2">
            {successNode}
            <p className="text-[13px] text-ink-3">The next issue lands Monday.</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2.5">
            {honeypot}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                aria-label="Email address"
                placeholder="you@email.com"
                value={email}
                onChange={(e) => onInput(e.target.value)}
                disabled={status === "loading"}
                className="h-11 w-full rounded-lg border border-line bg-bg-1 px-4 text-[14px] text-ink outline-none placeholder:text-ink-4 focus:border-yellow/60 sm:max-w-[320px]"
              />
              <button
                type="submit"
                disabled={status === "loading"}
                className="h-11 shrink-0 rounded-lg bg-yellow px-5 text-[14px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {status === "loading" ? "Subscribing…" : "Subscribe"}
              </button>
            </div>
            {status === "error" && error && (
              <p role="alert" className="text-[12.5px] text-red">
                {error}
              </p>
            )}
            {consent}
          </form>
        )}
      </div>
    </Section>
  );
}
