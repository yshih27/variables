import { test } from "node:test";
import assert from "node:assert/strict";
import { sendEmail } from "@/lib/email/resend";
import { createEmailNotifier } from "./email";
import { createTelegramNotifier, parseStartUpdate, telegramDeepLink, telegramAvailable, telegramConfig } from "./telegram";
import { composeDigests, volumeSignal, type FiredEvent } from "@/lib/alerts/signals";
import { volume, NOW } from "@/lib/alerts/fixtures.test-helpers";
import type { Recipient } from "./types";

const digest = composeDigests(
  [{ ...volumeSignal(volume(), undefined).event!, subscriptionId: "s1", fingerprint: "f1", firedAt: NOW } as FiredEvent],
  () => ({ subscriberId: "r1", channel: "email" }),
)[0];
const who: Recipient = { subscriberId: "r1", email: "reader@example.invalid", unsubscribeToken: "UNSUB", manageToken: "MANAGE", telegramChatId: "4242" };

test("Resend: the one-click List-Unsubscribe headers ride on every send that names a token", async () => {
  const prev = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_test";
  let body: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (_u, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
  };
  try {
    const r = await sendEmail({ to: "reader@example.invalid", subject: "s", html: "<p>h</p>", unsubscribeToken: "UNSUB" }, { fetchImpl });
    assert.deepEqual(r, { ok: true, id: "em_1", delivered: true });
    const headers = body.headers as Record<string, string>;
    assert.match(headers["List-Unsubscribe"], /^<https?:\/\/[^>]+\/api\/unsubscribe\?token=UNSUB>$/);
    assert.equal(headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  } finally {
    if (prev === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prev;
  }
});

test("email notifier: renders the digest, hands the unsubscribe token to the send path, paces and retries", async () => {
  const calls: { subject: string; unsubscribeToken?: string; html: string }[] = [];
  let failures = 1;
  const waits: number[] = [];
  const n = createEmailNotifier({
    send: async (i) => {
      calls.push(i);
      if (failures-- > 0) return { ok: false, error: "Resend 429" };
      return { ok: true, id: "x", delivered: true };
    },
    sleep: async (ms) => void waits.push(ms),
  });
  const r = await n.send(who, digest);
  assert.deepEqual(r, { ok: true, delivered: true });
  assert.equal(calls.length, 2); // one retry after the 429
  assert.equal(calls[0].unsubscribeToken, "UNSUB");
  assert.match(calls[0].subject, /^1 alert: Beezie volume 2\.4× its daily mean$/);
  assert.match(calls[0].html, /alerts\?token=MANAGE/);
  assert.ok(waits.length >= 1);
});

test("telegram: unavailable without a token — nothing is attempted", async () => {
  let called = false;
  const n = createTelegramNotifier({ config: { token: null, username: null, webhookSecret: null }, fetchImpl: async () => ((called = true), new Response("")) });
  assert.equal(n.available, false);
  assert.deepEqual(await n.send(who, digest), { ok: false, error: "telegram unavailable" });
  assert.equal(called, false);
  assert.equal(telegramAvailable(telegramConfig({})), false);
});

test("telegram: the digest goes out as ONE message through the transport", async () => {
  const seen: { url: string; body: Record<string, unknown> }[] = [];
  const n = createTelegramNotifier({
    config: { token: "123:ABC", username: "VaribleAlertsBot", webhookSecret: "s" },
    fetchImpl: async (u, init) => {
      seen.push({ url: String(u), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  assert.deepEqual(await n.send(who, digest), { ok: true, delivered: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.telegram.org/bot123:ABC/sendMessage");
  assert.equal(seen[0].body.chat_id, "4242");
  assert.match(String(seen[0].body.text), /^1 alert: Beezie volume 2\.4× its daily mean\n\n• Beezie: \$240K on Sep 23 UTC/);
  assert.match(String(seen[0].body.text), /Manage alerts: https?:\/\/.+\/alerts\?token=MANAGE$/);
  // not linked → not attempted
  assert.deepEqual(await n.send({ ...who, telegramChatId: null }, digest), { ok: false, error: "telegram not linked" });
  assert.equal(seen.length, 1);
});

test("telegram linking: the deep link and the /start update", () => {
  const c = { token: "t", username: "VaribleAlertsBot", webhookSecret: "s" };
  assert.equal(telegramDeepLink("abc12345", c), "https://t.me/VaribleAlertsBot?start=abc12345");
  assert.deepEqual(parseStartUpdate({ message: { text: "/start abc12345", chat: { id: 4242 } } }), { code: "abc12345", chatId: "4242" });
  assert.deepEqual(parseStartUpdate({ message: { text: "/start@VaribleAlertsBot abc12345", chat: { id: -100 } } }), { code: "abc12345", chatId: "-100" });
  assert.equal(parseStartUpdate({ message: { text: "hello", chat: { id: 1 } } }), null);
  assert.equal(parseStartUpdate({ message: { text: "/start", chat: { id: 1 } } }), null);
  assert.equal(parseStartUpdate(null), null);
});

test("telegram, end to end through the injected transport: the deep link, then /start links the chat and the bot answers", async () => {
  const { handleTelegramStart, handleTelegramWebhook, TELEGRAM_LINKED_TEXT, TELEGRAM_EXPIRED_TEXT } = await import("./telegram");
  const config = { token: "123:ABC", username: "VaribleAlertsBot", webhookSecret: "hook-secret" };
  const codes = new Map<string, string>(); // code → subscriber
  const chats = new Map<string, string>(); // subscriber → chat
  const sent: { url: string; chat: unknown; text: unknown }[] = [];
  const fetchImpl: typeof fetch = async (u, init) => {
    const b = JSON.parse(String(init?.body));
    sent.push({ url: String(u), chat: b.chat_id, text: b.text });
    return new Response("{}", { status: 200 });
  };
  const start = await handleTelegramStart("MANAGE-TOKEN", {
    config,
    subscriberIdOf: async (t) => (t === "MANAGE-TOKEN" ? "r1" : null),
    issue: async (id, code) => void codes.set(code, id),
    code: () => "c0ffee1234",
  });
  assert.deepEqual(start, { status: 200, url: "https://t.me/VaribleAlertsBot?start=c0ffee1234" });
  assert.deepEqual(await handleTelegramStart("nope", { config, subscriberIdOf: async () => null, issue: async () => {}, code: () => "x" }), { status: 404, error: "unknown-token" });

  const link = async (code: string, chat: string) => {
    const id = codes.get(code);
    if (!id) return false;
    codes.delete(code); // one-time
    chats.set(id, chat);
    return true;
  };
  const same = (a: string, b: string) => a === b;
  assert.deepEqual(await handleTelegramWebhook("wrong", {}, { config, link, fetchImpl, sameSecret: same }), { status: 404 });
  assert.deepEqual(await handleTelegramWebhook("hook-secret", { message: { text: "hi", chat: { id: 7 } } }, { config, link, fetchImpl, sameSecret: same }), { status: 200 });
  const update = { message: { text: "/start c0ffee1234", chat: { id: 4242 } } };
  assert.deepEqual(await handleTelegramWebhook("hook-secret", update, { config, link, fetchImpl, sameSecret: same }), { status: 200, linked: true });
  assert.equal(chats.get("r1"), "4242");
  // The same code again: spent.
  assert.deepEqual(await handleTelegramWebhook("hook-secret", update, { config, link, fetchImpl, sameSecret: same }), { status: 200, linked: false });
  assert.deepEqual(sent.map((s) => [s.url, s.chat, s.text]), [
    ["https://api.telegram.org/bot123:ABC/sendMessage", "4242", TELEGRAM_LINKED_TEXT],
    ["https://api.telegram.org/bot123:ABC/sendMessage", "4242", TELEGRAM_EXPIRED_TEXT],
  ]);
});
