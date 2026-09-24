/**
 * GET /api/alerts/telegram/start?token=<manage_token> → { ok, url }, the deep
 * link https://t.me/<bot>?start=<one-time code> (15 minutes). Opening it and
 * pressing Start sends `/start <code>` to the webhook, which links the chat.
 * Unknown token → the neutral answer; no bot configured → unavailable.
 */
import { rateLimitInMemory } from "@/lib/api/auth";
import { subscriberByManageToken } from "@/lib/subscribe/subscribers";
import { issueTelegramCode, TELEGRAM_CODE_TTL_MS } from "@/lib/alerts/store";
import { handleTelegramStart, telegramConfig } from "@/lib/notify/telegram";
import { ALERT_LINK_UNKNOWN, NO_STORE } from "@/lib/alerts/api";

export const dynamic = "force-dynamic";

function oneTimeCode(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function GET(req: Request) {
  const rl = rateLimitInMemory(req, { bucket: "alerts-manage", limit: 30, windowSec: 60 });
  if (!rl.ok) return Response.json({ ok: false, error: rl.error }, { status: 429, headers: NO_STORE });
  const token = new URL(req.url).searchParams.get("token")?.trim() ?? "";
  try {
    const r = await handleTelegramStart(token, {
      config: telegramConfig(),
      subscriberIdOf: async (t) => (await subscriberByManageToken(t))?.id ?? null,
      issue: (id, code) => issueTelegramCode(id, code),
      code: oneTimeCode,
    });
    if (r.status === 404)
      return Response.json({ ok: false, error: r.error === "unavailable" ? "Telegram isn’t available here." : ALERT_LINK_UNKNOWN }, { status: 404, headers: NO_STORE });
    return Response.json({ ok: true, url: r.url, expiresInMinutes: TELEGRAM_CODE_TTL_MS / 60_000 }, { headers: NO_STORE });
  } catch (e) {
    console.warn(`[alerts] telegram start failed: ${(e as Error).message}`);
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
