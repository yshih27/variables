/**
 * The email notifier: the digest rendered by `alertDigestEmail`, sent through
 * the one send path (`sendEmail`), with the RFC-8058 List-Unsubscribe headers
 * riding along. `send` and `sleep` are injectable so the tests capture what
 * would go out without waiting.
 *
 * ⚠️ PACED. Resend's default cap is 2 requests a second; the weekly sender
 * paces at 600 ms and retries a 429 with backoff, and so does this. A run
 * therefore sends at most ~1.8 digests a second: evaluation is seconds (1,000
 * watches measured at 4.2 s), the send phase is bounded by this pace.
 */
import { sendEmail, type SendEmailInput, type SendResult } from "@/lib/email/resend";
import { alertDigestEmail } from "@/lib/email/templates";
import type { Notifier } from "./types";

export const EMAIL_SEND_INTERVAL_MS = 550;
const ATTEMPTS = 3;

export function createEmailNotifier(
  opts: { send?: (input: SendEmailInput) => Promise<SendResult>; sleep?: (ms: number) => Promise<void>; intervalMs?: number } = {},
): Notifier {
  const send = opts.send ?? ((i) => sendEmail(i));
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const interval = opts.intervalMs ?? EMAIL_SEND_INTERVAL_MS;
  let lastAt = 0;
  return {
    channel: "email",
    available: true, // without RESEND_API_KEY the one send path logs instead of delivering
    async send(r, digest) {
      const mail = alertDigestEmail(digest, { hrefOf: (e) => e.entity.href, manageToken: r.manageToken, unsubscribeToken: r.unsubscribeToken });
      const input = { to: r.email, subject: mail.subject, html: mail.html, text: mail.text, unsubscribeToken: r.unsubscribeToken };
      let res: SendResult = { ok: false, error: "not sent" };
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        const wait = lastAt + interval * (attempt === 1 ? 1 : 2 ** (attempt - 1)) - Date.now();
        if (wait > 0) await sleep(wait);
        lastAt = Date.now();
        res = await send(input);
        if (res.ok) break;
      }
      return res.ok ? { ok: true, delivered: res.delivered } : { ok: false, error: res.error };
    },
  };
}
