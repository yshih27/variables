/**
 * POST /api/alerts — "Alert me": { email, entity_type, entity_key, kinds, channel, website? }
 *   • a new, pending or unsubscribed address → the double opt-in confirmation
 *     email; the watch is stored now and stays silent until the reader confirms
 *   • a confirmed address → the watch, and a "your alert is on" email with the
 *     manage link
 *   Always { ok: true, message } with the same sentence: the answer never says
 *   which. Honeypot `website`, 5 per 10 minutes per IP (as /api/subscribe).
 *
 * GET /api/alerts?token=<manage_token> — the reader's watches, labelled from the
 *   naming SSOTs, with the channels this deployment offers. An unknown token →
 *   the neutral answer, 404. No address is ever returned.
 *
 * Same-origin only (no CORS headers). No address, token or chat id in any log.
 */
import { rateLimitByIp, rateLimitInMemory } from "@/lib/api/auth";
import { subscribeEmail, ensureManageToken, subscriberByManageToken } from "@/lib/subscribe/subscribers";
import { upsertWatch, listWatches, telegramLinked } from "@/lib/alerts/store";
import { parseWatchInput, resolveForRoute, ALERT_CREATED_MESSAGE, ALERT_LINK_UNKNOWN, NO_STORE } from "@/lib/alerts/api";
import { resolveEntity } from "@/lib/alerts/entities";
import { sendEmail } from "@/lib/email/resend";
import { confirmationEmail, alertOnEmail } from "@/lib/email/templates";
import { telegramAvailable } from "@/lib/notify/telegram";

export const dynamic = "force-dynamic";

const OK = { ok: true, message: ALERT_CREATED_MESSAGE };

export async function POST(req: Request) {
  const rl = await rateLimitByIp(req, { bucket: "alerts", limit: 5, windowSec: 600 });
  if (!rl.ok) return Response.json({ ok: false, error: rl.error }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  // Honeypot — the same answer, nothing written, nothing sent.
  if (typeof body.website === "string" && body.website.trim() !== "") return Response.json(OK);

  const parsed = parseWatchInput(body, { telegramAvailable: telegramAvailable() });
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  const w = parsed.value;
  const entity = await resolveForRoute(w.entityType, w.entityKey);
  if (!entity) return Response.json({ ok: false, error: "We don’t track that yet." }, { status: 400 });

  try {
    const sub = await subscribeEmail({ email: w.email, source: `alert:${w.entityType}` });
    await upsertWatch({ subscriberId: sub.subscriberId, entityType: entity.type, entityKey: entity.key, kinds: w.kinds, channel: w.channel });
    const mail =
      sub.action === "confirm"
        ? confirmationEmail(sub.confirmToken, sub.unsubscribeToken, { label: entity.label })
        : alertOnEmail({ labels: [entity.label], manageToken: await ensureManageToken(sub.subscriberId), unsubscribeToken: sub.unsubscribeToken });
    const sent = await sendEmail({ to: w.email, subject: mail.subject, html: mail.html, text: mail.text, unsubscribeToken: sub.unsubscribeToken });
    if (!sent.ok) {
      console.warn(`[alerts] create: email send failed (${w.entityType}, ${w.kinds.length} kinds)`);
      return Response.json({ ok: false, error: "Couldn’t send the email. Please try again." }, { status: 502 });
    }
    console.info(`[alerts] create ${w.entityType} kinds=${w.kinds.join("+")} channel=${w.channel}`);
  } catch (e) {
    console.warn(`[alerts] create failed: ${(e as Error).message}`);
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
  return Response.json(OK);
}

export async function GET(req: Request) {
  const rl = rateLimitInMemory(req, { bucket: "alerts-manage", limit: 30, windowSec: 60 });
  if (!rl.ok) return Response.json({ ok: false, error: rl.error }, { status: 429, headers: NO_STORE });
  const token = new URL(req.url).searchParams.get("token")?.trim() ?? "";
  try {
    const sub = token ? await subscriberByManageToken(token) : null;
    if (!sub) return Response.json({ ok: false, error: ALERT_LINK_UNKNOWN }, { status: 404, headers: NO_STORE });
    const [watches, linked] = await Promise.all([listWatches(sub.id), telegramLinked(sub.id).catch(() => false)]);
    return Response.json(
      {
        ok: true,
        subscribed: sub.active,
        channels: { email: "available", telegram: telegramAvailable() ? "available" : "unavailable" },
        telegram: { linked },
        watches: watches.map((w) => {
          // Labels from the naming SSOTs; an identity that has since left the
          // index still reads from its own slug rather than as a raw key.
          const e = resolveEntity(w.entityType, w.entityKey);
          return {
            id: w.id,
            entity_type: w.entityType,
            entity_key: w.entityKey,
            label: e?.label ?? w.entityKey,
            href: e?.href ?? null,
            kinds: w.kinds,
            channel: w.channel,
            paused: !!w.pausedAt,
            created_at: w.createdAt,
          };
        }),
      },
      { headers: NO_STORE },
    );
  } catch (e) {
    console.warn(`[alerts] manage read failed: ${(e as Error).message}`);
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
