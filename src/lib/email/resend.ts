/**
 * Resend client — the single send path for all outbound email (confirmation +
 * weekly report). Thin fetch wrapper over the Resend REST API (no SDK dependency).
 *
 * Every send that names an `unsubscribeToken` automatically attaches the RFC-8058
 * one-click headers our /api/unsubscribe route was built for:
 *   List-Unsubscribe: <https://<site>/api/unsubscribe?token=TOKEN>
 *   List-Unsubscribe-Post: List-Unsubscribe=One-Click
 *
 * Env:
 *   RESEND_API_KEY  — server-only; when ABSENT the send is LOGGED, not delivered
 *                     (dev/preview convenience — no accidental sends without a key).
 *   EMAIL_FROM      — "Varible <report@mail.example.com>" (domain must be verified
 *                     in Resend). Falls back to a placeholder that Resend rejects,
 *                     so a misconfigured prod fails loudly rather than sending as junk.
 *
 * Link origin comes from SITE_ORIGIN (src/lib/site.ts) — the ONE definition of the
 * public origin. Never read NEXT_PUBLIC_SITE_URL here directly.
 */
import { SITE_ORIGIN } from "../site";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Unsubscribe token → sets the List-Unsubscribe one-click headers. */
  unsubscribeToken?: string;
};

export type SendResult =
  | { ok: true; id: string; delivered: true }
  | { ok: true; delivered: false } // logged-only (no API key)
  | { ok: false; error: string };

/** Absolute unsubscribe URL for a token — shared by the header + the email footer link. */
export function unsubscribeUrl(token: string): string {
  return `${SITE_ORIGIN}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** Absolute confirmation URL for a token. */
export function confirmUrl(token: string): string {
  return `${SITE_ORIGIN}/api/confirm?token=${encodeURIComponent(token)}`;
}

export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const from = process.env.EMAIL_FROM || "Varible <onboarding@resend.dev>";
  const headers: Record<string, string> = {};
  if (input.unsubscribeToken) {
    headers["List-Unsubscribe"] = `<${unsubscribeUrl(input.unsubscribeToken)}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // No key → log-only. Loud, so a misconfigured PROD is obvious in the logs.
    console.warn(
      `[email] RESEND_API_KEY not set — NOT sending. to=${input.to} subject="${input.subject}"` +
        (input.unsubscribeToken ? ` (List-Unsubscribe set)` : ""),
    );
    return { ok: true, delivered: false };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json()) as { id?: string };
    return { ok: true, id: json.id ?? "", delivered: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
