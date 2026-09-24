/**
 * GET /api/alerts/channels — which channels this deployment can deliver on, so
 * the sheet never offers one that cannot: email always (log-only without a
 * Resend key, which is a deployment fact, not a reader's); Telegram only when
 * the bot's token, username and webhook secret are all set.
 */
import { telegramAvailable } from "@/lib/notify/telegram";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { ok: true, channels: { email: "available", telegram: telegramAvailable() ? "available" : "unavailable" } },
    { headers: { "cache-control": "public, s-maxage=300" } },
  );
}
