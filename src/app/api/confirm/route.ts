/**
 * GET /api/confirm?token=… — double opt-in confirmation.
 *
 * Activates a pending subscription (sets confirmed_at), then redirects to
 * /report?confirmed=1. Idempotent — a second click still confirms. An unknown
 * token gets a neutral page.
 *
 * GET is fine here (unlike unsubscribe): a link-prefetch that confirms only
 * activates a subscription the user explicitly requested — not a destructive act.
 */
import { confirmSubscriber } from "@/lib/subscribe/subscribers";

export const dynamic = "force-dynamic";

function page(message: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Confirm · VARIBLE</title></head><body style="font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#111;line-height:1.6"><p style="font-size:1.05rem">${message}</p><p><a href="/report" style="color:#555">← Go to the report</a></p></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token")?.trim() ?? "";
  if (!token) return page("This confirmation link is missing its token.", 400);

  let result: Awaited<ReturnType<typeof confirmSubscriber>>;
  try {
    result = await confirmSubscriber(token);
  } catch (e) {
    console.warn(`[confirm] failed: ${(e as Error).message}`);
    return page("Something went wrong. Please try again later.", 500);
  }

  if (result === "confirmed" || result === "already_confirmed") {
    return Response.redirect(new URL("/report?confirmed=1", req.url), 303);
  }
  return page("This confirmation link isn’t recognized — it may have expired. Try subscribing again.", 404);
}
