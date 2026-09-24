/**
 * The alert tables' ONE accessor — alert_subscriptions, alert_state,
 * alert_events, telegram_links (migrations 20260925000001/2). Nothing else
 * reads or writes them. Subscriber rows (addresses, tokens) stay behind
 * src/lib/subscribe/subscribers.ts; this module only ever holds subscriber IDS.
 *
 * ⚠️ SERVER-ONLY. No log line here carries an id's owner, a token or a chat id:
 * counts and kinds only.
 *
 * `AlertStore` is the seam the run is written against, so the dry run, the
 * fixture run and the unit tests drive the same code with `memoryAlertStore`
 * (memoryStore.ts) and nothing touches production until `--send`.
 */
import { db } from "@/lib/db/client";
import type { AlertEntityType, AlertKind } from "./signals";

export type AlertChannel = "email" | "telegram";

export type AlertSubscription = {
  id: string;
  subscriberId: string;
  entityType: AlertEntityType;
  entityKey: string;
  kinds: AlertKind[];
  channel: AlertChannel;
  createdAt: string;
  pausedAt: string | null;
};

export type StateRow = { subscriptionId: string; key: string; value: unknown };
export type EventRow = { subscriptionId: string; kind: AlertKind; fingerprint: string; payload: unknown; firedAt: string };

export interface AlertStore {
  /** Every watch not paused (the run then keeps only confirmed, active readers'). */
  listActiveSubscriptions(): Promise<AlertSubscription[]>;
  /** subscription id → state key → value. */
  readStates(subscriptionIds: string[]): Promise<Map<string, Map<string, unknown>>>;
  writeStates(rows: StateRow[]): Promise<void>;
  /** The fingerprints among `fps` already recorded — the dedupe. */
  existingFingerprints(fps: string[]): Promise<Set<string>>;
  /** Insert fired events; returns fingerprint → event id. A fingerprint that
   *  already exists (a concurrent run) is skipped, not an error. */
  insertEvents(rows: EventRow[]): Promise<Map<string, string>>;
  markSent(eventIds: string[], at: string): Promise<void>;
  /** subscriber id → linked Telegram chat id. */
  telegramChats(subscriberIds: string[]): Promise<Map<string, string>>;
}

const CHUNK = 300;
const chunks = <T,>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));

type SubRow = { id: string; subscriber_id: string; entity_type: AlertEntityType; entity_key: string; kinds: AlertKind[]; channel: AlertChannel; created_at: string; paused_at: string | null };
const toSub = (r: SubRow): AlertSubscription => ({
  id: String(r.id),
  subscriberId: String(r.subscriber_id),
  entityType: r.entity_type,
  entityKey: r.entity_key,
  kinds: r.kinds,
  channel: r.channel,
  createdAt: r.created_at,
  pausedAt: r.paused_at,
});
const SUB_COLS = "id, subscriber_id, entity_type, entity_key, kinds, channel, created_at, paused_at";

export const supabaseAlertStore: AlertStore = {
  async listActiveSubscriptions() {
    const out: AlertSubscription[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db()
        .from("alert_subscriptions")
        .select(SUB_COLS)
        .is("paused_at", null)
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(`[alerts] subscriptions read failed: ${error.message}`);
      for (const r of (data ?? []) as SubRow[]) out.push(toSub(r));
      if ((data ?? []).length < 1000) break;
    }
    return out;
  },
  async readStates(ids) {
    const out = new Map<string, Map<string, unknown>>();
    for (const part of chunks([...new Set(ids)])) {
      const { data, error } = await db().from("alert_state").select("subscription_id, key, value").in("subscription_id", part);
      if (error) throw new Error(`[alerts] state read failed: ${error.message}`);
      for (const r of data ?? []) {
        const id = String(r.subscription_id);
        (out.get(id) ?? out.set(id, new Map()).get(id)!).set(r.key as string, r.value);
      }
    }
    return out;
  },
  async writeStates(rows) {
    const now = new Date().toISOString();
    for (const part of chunks(rows)) {
      const { error } = await db()
        .from("alert_state")
        .upsert(part.map((r) => ({ subscription_id: r.subscriptionId, key: r.key, value: r.value, updated_at: now })), { onConflict: "subscription_id,key" });
      if (error) throw new Error(`[alerts] state write failed: ${error.message}`);
    }
  },
  async existingFingerprints(fps) {
    const out = new Set<string>();
    for (const part of chunks([...new Set(fps)])) {
      const { data, error } = await db().from("alert_events").select("fingerprint").in("fingerprint", part);
      if (error) throw new Error(`[alerts] fingerprint read failed: ${error.message}`);
      for (const r of data ?? []) out.add(r.fingerprint as string);
    }
    return out;
  },
  async insertEvents(rows) {
    const out = new Map<string, string>();
    for (const part of chunks(rows)) {
      const { data, error } = await db()
        .from("alert_events")
        .upsert(
          part.map((r) => ({ subscription_id: r.subscriptionId, kind: r.kind, fingerprint: r.fingerprint, payload: r.payload, fired_at: r.firedAt })),
          { onConflict: "fingerprint", ignoreDuplicates: true },
        )
        .select("id, fingerprint");
      if (error) throw new Error(`[alerts] event insert failed: ${error.message}`);
      for (const r of data ?? []) out.set(r.fingerprint as string, String(r.id));
    }
    return out;
  },
  async markSent(ids, at) {
    for (const part of chunks(ids)) {
      const { error } = await db().from("alert_events").update({ sent_at: at }).in("id", part);
      if (error) throw new Error(`[alerts] mark-sent failed: ${error.message}`);
    }
  },
  async telegramChats(subscriberIds) {
    const out = new Map<string, string>();
    for (const part of chunks([...new Set(subscriberIds)])) {
      const { data, error } = await db().from("telegram_links").select("subscriber_id, chat_id").in("subscriber_id", part).not("chat_id", "is", null);
      if (error) throw new Error(`[alerts] telegram read failed: ${error.message}`);
      for (const r of data ?? []) out.set(String(r.subscriber_id), r.chat_id as string);
    }
    return out;
  },
};

// ── watch management (the routes) ────────────────────────────────────────────

/**
 * Store a watch: a new one, or the same (entity, channel) again with the new
 * kinds and un-paused. A watch belonging to a reader who has not confirmed is
 * stored and stays silent: the run only loads confirmed, active readers.
 */
export async function upsertWatch(w: { subscriberId: string; entityType: AlertEntityType; entityKey: string; kinds: AlertKind[]; channel: AlertChannel }): Promise<AlertSubscription> {
  const { data, error } = await db()
    .from("alert_subscriptions")
    .upsert(
      { subscriber_id: w.subscriberId, entity_type: w.entityType, entity_key: w.entityKey, kinds: w.kinds, channel: w.channel, paused_at: null },
      { onConflict: "subscriber_id,entity_type,entity_key,channel" },
    )
    .select(SUB_COLS)
    .single();
  if (error) throw new Error(`[alerts] watch upsert failed: ${error.message}`);
  return toSub(data as SubRow);
}

export async function listWatches(subscriberId: string): Promise<AlertSubscription[]> {
  const { data, error } = await db().from("alert_subscriptions").select(SUB_COLS).eq("subscriber_id", subscriberId).order("created_at", { ascending: true });
  if (error) throw new Error(`[alerts] watches read failed: ${error.message}`);
  return ((data ?? []) as SubRow[]).map(toSub);
}

/** pause / resume / delete ONE watch — scoped to its owner, so a token can only touch its own. */
export async function updateWatch(subscriberId: string, id: string, action: "pause" | "resume" | "delete"): Promise<boolean> {
  const q =
    action === "delete"
      ? db().from("alert_subscriptions").delete()
      : db().from("alert_subscriptions").update({ paused_at: action === "pause" ? new Date().toISOString() : null });
  const { data, error } = await q.eq("id", id).eq("subscriber_id", subscriberId).select("id");
  if (error) throw new Error(`[alerts] watch ${action} failed: ${error.message}`);
  return !!data?.length;
}

/** An unsubscribe (mark mode) pauses every watch with the reader. */
export async function pauseAllWatches(subscriberId: string): Promise<number> {
  const { data, error } = await db()
    .from("alert_subscriptions")
    .update({ paused_at: new Date().toISOString() })
    .eq("subscriber_id", subscriberId)
    .is("paused_at", null)
    .select("id");
  if (error) throw new Error(`[alerts] pause-all failed: ${error.message}`);
  return data?.length ?? 0;
}

// ── telegram linking ─────────────────────────────────────────────────────────

/** How long a deep link's one-time code is good for. */
export const TELEGRAM_CODE_TTL_MS = 15 * 60_000;

/** A fresh one-time code for this reader (replaces any earlier unused one). */
export async function issueTelegramCode(subscriberId: string, code: string, now = Date.now()): Promise<void> {
  const { error } = await db()
    .from("telegram_links")
    .upsert(
      { subscriber_id: subscriberId, link_code: code, link_code_expires_at: new Date(now + TELEGRAM_CODE_TTL_MS).toISOString() },
      { onConflict: "subscriber_id" },
    );
  if (error) throw new Error(`[alerts] telegram code write failed: ${error.message}`);
}

/** `/start <code>` from the bot: store the chat, spend the code. True when linked. */
export async function linkTelegramChat(code: string, chatId: string, now = Date.now()): Promise<boolean> {
  const { data, error } = await db()
    .from("telegram_links")
    .update({ chat_id: chatId, linked_at: new Date(now).toISOString(), link_code: null, link_code_expires_at: null })
    .eq("link_code", code)
    .gt("link_code_expires_at", new Date(now).toISOString())
    .select("subscriber_id");
  if (error) throw new Error(`[alerts] telegram link failed: ${error.message}`);
  return !!data?.length;
}

export async function telegramLinked(subscriberId: string): Promise<boolean> {
  const { data, error } = await db().from("telegram_links").select("chat_id").eq("subscriber_id", subscriberId).maybeSingle();
  if (error) throw new Error(`[alerts] telegram read failed: ${error.message}`);
  return !!data?.chat_id;
}
