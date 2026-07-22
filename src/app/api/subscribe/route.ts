/**
 * POST /api/subscribe — double opt-in signup for the weekly report.
 *
 * Body: { email: string, source?: string, website?: string }
 *   • email    — validated server-side; stored lowercased + trimmed.
 *   • source   — where the signup came from ("report-page" | "footer" | …).
 *   • website  — HONEYPOT. A real form keeps this hidden + empty; a bot fills it.
 *                Non-empty → we return generic success WITHOUT writing or sending.
 *
 * Flow: creates/refreshes a PENDING subscriber and sends a confirmation email; the
 * subscriber is not active (won't receive the report) until they click the link.
 *
 * Privacy: the response is ALWAYS the same generic success for any valid email —
 * new, pending, or already-subscribed — so it never reveals whether an address is
 * on the list. Only a bad email FORMAT (leaks nothing) or a server error differs.
 */
import { rateLimitByIp } from "@/lib/api/auth";
import { subscribeEmail } from "@/lib/subscribe/subscribers";
import { sendEmail } from "@/lib/email/resend";
import { confirmationEmail } from "@/lib/email/templates";

export const dynamic = "force-dynamic";

// Deliberately simple — catches obvious garbage without the false-negatives of a
// full RFC-5322 regex. Deliverability is enforced by the confirmation step.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Double opt-in: the CTA is "check your email", not "you're on the list".
const GENERIC_SUCCESS = { ok: true, message: "Almost there — check your email to confirm." };

export async function POST(req: Request) {
  // Throttle first (cheap; shields the DB from a flood).
  const rl = await rateLimitByIp(req, { bucket: "subscribe", limit: 5, windowSec: 600 });
  if (!rl.ok) return Response.json({ ok: false, error: rl.error }, { status: 429 });

  let body: { email?: unknown; source?: unknown; website?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  // Honeypot — silently succeed, write nothing. A bot shouldn't learn it was caught.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return Response.json(GENERIC_SUCCESS);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    // Format errors leak nothing about who's subscribed, so a real 400 is fine.
    return Response.json({ ok: false, error: "Please enter a valid email address." }, { status: 400 });
  }
  const source =
    typeof body.source === "string" && body.source.trim() ? body.source.trim().slice(0, 64) : "unknown";

  try {
    const result = await subscribeEmail({ email, source });
    if (result.action === "confirm") {
      const mail = confirmationEmail(result.confirmToken, result.unsubscribeToken);
      const sent = await sendEmail({
        to: email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        unsubscribeToken: result.unsubscribeToken,
      });
      if (!sent.ok) {
        // Confirmation didn't go out. Leave the row PENDING (harmless — it's never
        // emailed again and never receives the report until confirmed); a retry
        // re-issues a fresh token + resends. Surface a retryable error, no details.
        console.warn(`[subscribe] confirmation send failed: ${sent.error}`);
        return Response.json({ ok: false, error: "Couldn't send the confirmation email. Please try again." }, { status: 502 });
      }
    }
    // action === "already_active" → send nothing (never reveal they're subscribed).
  } catch (e) {
    console.warn(`[subscribe] failed: ${(e as Error).message}`);
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }

  // Same response whether new, pending, or already-subscribed.
  return Response.json(GENERIC_SUCCESS);
}
