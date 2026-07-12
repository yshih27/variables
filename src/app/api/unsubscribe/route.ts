/**
 * GET /api/unsubscribe?token=… — one-click unsubscribe from the weekly report.
 *
 * Sets `unsubscribed_at` for the matching subscriber (idempotent — an already-
 * unsubscribed token still confirms), then redirects to /report?unsubscribed=1.
 * An unknown token gets a plain, neutral confirmation page (no redirect, no leak).
 *
 * NOTE (for when sending goes live): a GET link can be auto-fetched by email
 * security scanners / link prefetchers, which would unsubscribe users who never
 * clicked. Before wiring Resend, move to RFC-8058 one-click POST, or gate this GET
 * behind a confirm button. Harmless today — no emails are being sent yet.
 */
import { unsubscribeByToken } from "@/lib/subscribe/subscribers";

export const dynamic = "force-dynamic";

function page(message: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Unsubscribe · VARIABLE</title></head><body style="font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#111;line-height:1.6"><p style="font-size:1.05rem">${message}</p><p><a href="/report" style="color:#555">← Back to the report</a></p></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token")?.trim() ?? "";
  if (!token) return page("This unsubscribe link is missing its token.", 400);

  let result: Awaited<ReturnType<typeof unsubscribeByToken>>;
  try {
    result = await unsubscribeByToken(token);
  } catch (e) {
    console.warn(`[unsubscribe] failed: ${(e as Error).message}`);
    return page("Something went wrong. Please try again later.", 500);
  }

  if (result === "unsubscribed") {
    // Same-origin redirect (works in dev + prod without a hardcoded host).
    return Response.redirect(new URL("/report?unsubscribed=1", req.url), 303);
  }
  return page("This unsubscribe link isn’t recognized — you may already be unsubscribed.", 404);
}
