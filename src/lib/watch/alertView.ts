import {
  CLEAR_MIN_USD,
  CLEAR_REFERENCE_MULTIPLE,
  FLOOR_MOVE_MIN,
  VOLUME_BASE_DAYS,
  VOLUME_SPIKE_MULTIPLE,
  KINDS_FOR,
  type AlertEntityType,
  type AlertKind,
} from "@/lib/alerts/rules";
import type { AlertChannel } from "@/lib/alerts/store";

/**
 * THE ALERT'S WORDS — what each kind of alert watches for, said once, from the
 * backend's own thresholds (imported, never typed), so the sheet, the manage
 * page and the email cannot state three different rules.
 */

export type { AlertChannel, AlertEntityType, AlertKind };

/** The kinds that apply to an entity — the backend's list, in its order. */
export function kindsFor(type: AlertEntityType): readonly AlertKind[] {
  return KINDS_FOR[type];
}

/** The chip's word for a kind. */
export function kindLabel(kind: AlertKind): string {
  switch (kind) {
    case "floor":
      return "floor";
    case "volume":
      return "volume";
    case "clear":
      return "big clear";
    case "listing":
      return "new listing";
  }
}

/**
 * The threshold as a receipt line — what makes this kind fire, for this
 * entity. The numbers are the backend's constants; this only puts them in a
 * sentence.
 */
export function kindRule(kind: AlertKind, type: AlertEntityType): string {
  switch (kind) {
    case "floor":
      return `floor moves ${Math.round(FLOOR_MOVE_MIN * 100)}% or more, or appears or disappears`;
    case "volume":
      return `daily volume ${VOLUME_SPIKE_MULTIPLE}× its ${VOLUME_BASE_DAYS}-day average`;
    case "clear":
      return type === "identity"
        ? `a clear at ${CLEAR_REFERENCE_MULTIPLE}× the reference price`
        : `a clear at $${CLEAR_MIN_USD.toLocaleString("en-US")} or more`;
    case "listing":
      return "a new listing, placeholder asks marked unverified";
  }
}

export function channelLabel(c: AlertChannel): string {
  return c === "email" ? "Email" : "Telegram";
}

/** `y•••@gmail.com` — enough for the reader to recognise their own address. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "your address";
  return `${user.slice(0, 1)}•••@${domain}`;
}
