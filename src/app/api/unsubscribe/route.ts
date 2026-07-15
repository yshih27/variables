/**
 * Unsubscribe from the weekly report — RFC 8058 one-click safe.
 *
 *   GET  /api/unsubscribe?token=…  → a confirmation PAGE with an "Unsubscribe"
 *        button. Does NOT mutate — so email link-scanners / prefetchers that GET
 *        the visible unsubscribe URL can't unsubscribe people who never clicked.
 *   POST /api/unsubscribe?token=…  → performs the unsubscribe. Serves two callers:
 *        • RFC-8058 one-click: a mailbox provider POSTs body `List-Unsubscribe=
 *          One-Click` → we return 204 (providers only check the status).
 *        • our confirm-page form → 303 redirect to /report?unsubscribed=1.
 *
 * The token IS the authorization (a long unguessable secret), so no session/CSRF
 * token is needed. Idempotent: an already-unsubscribed token still confirms.
 *
 * WHEN SENDING GOES LIVE (Resend, post-launch), the email MUST include:
 *   List-Unsubscribe: <https://<site>/api/unsubscribe?token=TOKEN>
 *   List-Unsubscribe-Post: List-Unsubscribe=One-Click
 */
import { unsubscribeByToken } from "@/lib/subscribe/subscribers";

export const dynamic = "force-dynamic";

function shell(body: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Unsubscribe · VARIBLE</title></head><body style="font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#111;line-height:1.6">${body}</body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function message(msg: string, status: number): Response {
  return shell(`<p style="font-size:1.05rem">${msg}</p><p><a href="/report" style="color:#555">← Back to the report</a></p>`, status);
}

/** Prefetch-safe confirm page — the button POSTs (see POST handler). */
function confirmPage(token: string): Response {
  const action = `/api/unsubscribe?token=${encodeURIComponent(token)}`;
  return shell(
    `<h1 style="font-size:1.25rem;font-weight:600;margin:0 0 .5rem">Unsubscribe from the Varible weekly report?</h1>` +
      `<p style="color:#555;margin:0 0 1.25rem">You'll stop receiving the weekly report email. You can re-subscribe anytime.</p>` +
      `<form method="POST" action="${action}"><button type="submit" style="font:inherit;font-weight:600;background:#111;color:#fff;border:0;border-radius:8px;padding:.6rem 1.1rem;cursor:pointer">Unsubscribe</button></form>`,
    200,
  );
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token")?.trim() ?? "";
  if (!token) return message("This unsubscribe link is missing its token.", 400);
  // Do NOT mutate on GET — just confirm. The button POSTs.
  return confirmPage(token);
}

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token")?.trim() ?? "";

  // RFC-8058 one-click providers POST `List-Unsubscribe=One-Click`; they only read
  // the status code. Our confirm form posts an empty body → browser redirect.
  let oneClick = false;
  try {
    oneClick = /(^|&)List-Unsubscribe=One-Click(&|$)/i.test(await req.text());
  } catch {
    /* no body */
  }

  if (!token) {
    return oneClick ? new Response("missing token", { status: 400 }) : message("This unsubscribe link is missing its token.", 400);
  }

  let result: Awaited<ReturnType<typeof unsubscribeByToken>>;
  try {
    result = await unsubscribeByToken(token);
  } catch (e) {
    console.warn(`[unsubscribe] failed: ${(e as Error).message}`);
    return oneClick ? new Response("error", { status: 500 }) : message("Something went wrong. Please try again later.", 500);
  }

  if (result === "unsubscribed") {
    if (oneClick) return new Response(null, { status: 204 }); // provider just wants success
    return Response.redirect(new URL("/report?unsubscribed=1", req.url), 303);
  }
  return oneClick
    ? new Response("not found", { status: 404 })
    : message("This unsubscribe link isn’t recognized — you may already be unsubscribed.", 404);
}
