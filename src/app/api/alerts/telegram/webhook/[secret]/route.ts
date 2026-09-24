/**
 * POST /api/alerts/telegram/webhook/<secret> — the bot's webhook. The path's
 * secret segment must equal TELEGRAM_WEBHOOK_SECRET (else 404, as if the route
 * did not exist). A `/start <code>` update links that chat to the code's reader
 * and the bot says so in the chat. Always 200 to Telegram for a valid secret,
 * so it never retries an update we chose to ignore. Never logs the chat id.
 * The logic is `handleTelegramWebhook` (notify/telegram.ts), tested there.
 *
 * Register once: https://api.telegram.org/bot<token>/setWebhook?url=<site>/api/alerts/telegram/webhook/<secret>
 */
import { timingSafeEqual } from "node:crypto";
import { linkTelegramChat } from "@/lib/alerts/store";
import { handleTelegramWebhook, telegramConfig } from "@/lib/notify/telegram";

export const dynamic = "force-dynamic";

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;
  let update: unknown = null;
  try {
    update = await req.json();
  } catch {
    /* an empty or broken body is ignored below */
  }
  try {
    const r = await handleTelegramWebhook(secret ?? "", update, { config: telegramConfig(), link: (code, chat) => linkTelegramChat(code, chat), sameSecret });
    if (r.status === 404) return new Response("not found", { status: 404 });
    if (r.linked !== undefined) console.info(`[alerts] telegram ${r.linked ? "linked" : "code expired"}`);
  } catch (e) {
    console.warn(`[alerts] telegram webhook failed: ${(e as Error).message}`);
  }
  return Response.json({ ok: true });
}
