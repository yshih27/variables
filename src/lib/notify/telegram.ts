/**
 * The Telegram notifier and the linking helpers. The same digest as the email,
 * as ONE message (render.ts `digestText`), via the Bot API.
 *
 *   TELEGRAM_BOT_TOKEN      — the bot's token; ABSENT → the channel is
 *                             "unavailable" and nothing is attempted.
 *   TELEGRAM_BOT_USERNAME   — for the deep link t.me/<bot>?start=<code>.
 *   TELEGRAM_WEBHOOK_SECRET — the webhook route's secret path segment.
 *
 * `fetchImpl` is injectable: the tests (and the PR's report) exercise the whole
 * path through a transport that records the request instead of calling Telegram.
 */
import { SITE_ORIGIN } from "@/lib/site";
import { manageUrl } from "@/lib/email/resend";
import { digestText } from "@/lib/alerts/render";
import type { Notifier } from "./types";

type Fetch = typeof fetch;

/** What the bot answers a `/start <code>`. */
export const TELEGRAM_LINKED_TEXT = "Linked. Your Varible alerts will arrive in this chat.";
export const TELEGRAM_EXPIRED_TEXT = "That link has expired. Open your manage page and tap Link Telegram again.";

export type TelegramConfig = { token: string | null; username: string | null; webhookSecret: string | null };

export function telegramConfig(env: Record<string, string | undefined> = process.env): TelegramConfig {
  return {
    token: env.TELEGRAM_BOT_TOKEN?.trim() || null,
    username: env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || null,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET?.trim() || null,
  };
}

/** Whether this deployment can deliver on Telegram at all. */
export const telegramAvailable = (c: TelegramConfig = telegramConfig()) => !!(c.token && c.username && c.webhookSecret);

/** https://t.me/<bot>?start=<code> — what the start route answers. */
export function telegramDeepLink(code: string, c: TelegramConfig = telegramConfig()): string | null {
  return c.username ? `https://t.me/${c.username}?start=${encodeURIComponent(code)}` : null;
}

/** Post one plain-text message. Never logs the chat id or the text. */
export async function telegramSendText(chatId: string, text: string, opts: { config?: TelegramConfig; fetchImpl?: Fetch } = {}): Promise<{ ok: boolean; error?: string }> {
  const c = opts.config ?? telegramConfig();
  if (!c.token) return { ok: false, error: "telegram unavailable" };
  const f = opts.fetchImpl ?? fetch;
  try {
    const res = await f(`https://api.telegram.org/bot${c.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Telegram caps a message at 4,096 characters; a digest longer than that is cut with its count.
      body: JSON.stringify({ chat_id: chatId, text: text.length > 4000 ? `${text.slice(0, 3990)}\n…` : text, disable_web_page_preview: true }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `telegram ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function createTelegramNotifier(opts: { config?: TelegramConfig; fetchImpl?: Fetch } = {}): Notifier {
  const config = opts.config ?? telegramConfig();
  return {
    channel: "telegram",
    available: telegramAvailable(config),
    async send(r, digest) {
      if (!telegramAvailable(config)) return { ok: false, error: "telegram unavailable" };
      if (!r.telegramChatId) return { ok: false, error: "telegram not linked" };
      const abs = (href: string) => (href.startsWith("http") ? href : `${SITE_ORIGIN}${href}`);
      const text = digestText(digest, { hrefOf: (e) => abs(e.entity.href), manageUrl: manageUrl(r.manageToken) });
      const res = await telegramSendText(r.telegramChatId, text, { config, fetchImpl: opts.fetchImpl });
      return res.ok ? { ok: true, delivered: true } : { ok: false, error: res.error ?? "telegram send failed" };
    },
  };
}

/** A `/start <code>` update from the bot's webhook → the code, or null. */
export function parseStartUpdate(update: unknown): { code: string; chatId: string } | null {
  const msg = (update as { message?: { text?: unknown; chat?: { id?: unknown } } } | null)?.message;
  const text = typeof msg?.text === "string" ? msg.text.trim() : "";
  const m = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{8,64})$/.exec(text);
  const chat = msg?.chat?.id;
  if (!m || (typeof chat !== "number" && typeof chat !== "string")) return null;
  return { code: m[1], chatId: String(chat) };
}

// ── the two linking handlers, route logic with injectable edges ──────────────

/** GET /api/alerts/telegram/start — resolve the manage token, issue a one-time
 *  code, answer the deep link. Pure over its deps (the route wires the store). */
export async function handleTelegramStart(
  token: string,
  deps: { config: TelegramConfig; subscriberIdOf: (manageToken: string) => Promise<string | null>; issue: (subscriberId: string, code: string) => Promise<void>; code: () => string },
): Promise<{ status: 200; url: string } | { status: 404; error: "unavailable" | "unknown-token" }> {
  if (!telegramAvailable(deps.config)) return { status: 404, error: "unavailable" };
  const id = token ? await deps.subscriberIdOf(token) : null;
  if (!id) return { status: 404, error: "unknown-token" };
  const code = deps.code();
  await deps.issue(id, code);
  return { status: 200, url: telegramDeepLink(code, deps.config)! };
}

/** POST /api/alerts/telegram/webhook/<secret> — a wrong secret is a 404; a
 *  `/start <code>` links the chat and the bot answers in it; anything else is
 *  acknowledged and ignored (200, so Telegram never retries it). */
export async function handleTelegramWebhook(
  secret: string,
  update: unknown,
  deps: { config: TelegramConfig; link: (code: string, chatId: string) => Promise<boolean>; fetchImpl?: Fetch; sameSecret: (a: string, b: string) => boolean },
): Promise<{ status: 200 | 404; linked?: boolean }> {
  const c = deps.config;
  if (!c.token || !c.webhookSecret || !deps.sameSecret(secret, c.webhookSecret)) return { status: 404 };
  const start = parseStartUpdate(update);
  if (!start) return { status: 200 };
  const linked = await deps.link(start.code, start.chatId);
  await telegramSendText(start.chatId, linked ? TELEGRAM_LINKED_TEXT : TELEGRAM_EXPIRED_TEXT, { config: c, fetchImpl: deps.fetchImpl });
  return { status: 200, linked };
}
