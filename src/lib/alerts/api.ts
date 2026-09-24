/**
 * The alert routes' shared rules: input validation (pure, tested), the API's
 * messages (ONE place, the frontend prints what the API returns) and the entity
 * resolver the routes use.
 *
 * ⚠️ THE CREATE ANSWER NEVER SAYS WHETHER AN ADDRESS IS KNOWN. A new address
 * gets a confirmation email, a confirmed one a manage link; the API says the
 * same sentence to both, and so does its status code.
 */
import { KINDS_FOR, type AlertEntityType, type AlertKind, type EntityRef } from "./signals";
import type { AlertChannel } from "./store";
import { resolveEntity } from "./entities";

export const ALERT_CREATED_MESSAGE = "Check your email to finish setting up this alert.";
/** The neutral answer for an unknown manage token: the confirm route's words. */
export const ALERT_LINK_UNKNOWN = "This link isn’t recognized. It may have expired.";
export const ALERT_UPDATE_MESSAGE: Record<"pause" | "resume" | "delete", string> = {
  pause: "Paused.",
  resume: "Watching again.",
  delete: "Deleted.",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WatchInput = { email: string; entityType: AlertEntityType; entityKey: string; kinds: AlertKind[]; channel: AlertChannel };

/** Validate a create body. Errors name the field; none reveals anything about subscribers. */
export function parseWatchInput(body: unknown, opts: { telegramAvailable: boolean }): { ok: true; value: WatchInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return { ok: false, error: "Please enter a valid email address." };
  const entityType = b.entity_type;
  if (entityType !== "identity" && entityType !== "ip" && entityType !== "platform") return { ok: false, error: "Unknown entity type." };
  const entityKey = typeof b.entity_key === "string" ? b.entity_key.trim() : "";
  if (!entityKey || entityKey.length > 300) return { ok: false, error: "Missing entity." };
  const allowed = KINDS_FOR[entityType];
  const kinds = Array.isArray(b.kinds) ? [...new Set(b.kinds.filter((k): k is AlertKind => typeof k === "string" && (allowed as readonly string[]).includes(k)))] : [];
  if (!kinds.length || kinds.length !== new Set(Array.isArray(b.kinds) ? b.kinds : []).size)
    return { ok: false, error: `Choose what to watch: ${allowed.join(", ")}.` };
  const channel = b.channel ?? "email";
  if (channel !== "email" && channel !== "telegram") return { ok: false, error: "Unknown channel." };
  if (channel === "telegram" && !opts.telegramAvailable) return { ok: false, error: "Telegram isn’t available here." };
  return { ok: true, value: { email, entityType, entityKey, kinds, channel } };
}

/** The action body of POST /api/alerts/update. */
export function parseUpdateInput(body: unknown): { ok: true; token: string; id: string; action: "pause" | "resume" | "delete" } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const token = typeof b.token === "string" ? b.token.trim() : "";
  const id = typeof b.id === "string" ? b.id.trim() : "";
  const action = b.action;
  if (!token || !/^[0-9a-f-]{36}$/i.test(id) || (action !== "pause" && action !== "resume" && action !== "delete")) return { ok: false, error: "Invalid request." };
  return { ok: true, token, id, action };
}

/** Resolve against the live slug index (identities must exist to be watched). */
export async function resolveForRoute(type: AlertEntityType, key: string): Promise<EntityRef | null> {
  if (type !== "identity") return resolveEntity(type, key);
  const { listIdentitySlugs } = await import("@/lib/data/identityDetail");
  const slugs = await listIdentitySlugs();
  return resolveEntity(type, key, (s) => slugs.get(s));
}

export const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex" };
