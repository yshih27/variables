/**
 * THE ALERT RULES — the kinds, which entity each applies to, and the thresholds,
 * with NO imports: the leaf both sides read. `signals.ts` (server: it reads the
 * spine and the identity view) re-exports all of it; the sheet and the manage
 * page (client) import it from here, so printing a threshold never drags the
 * server's data modules into the browser bundle.
 */
export type AlertKind = "floor" | "volume" | "clear" | "listing";
export type AlertEntityType = "identity" | "ip" | "platform";
export const ALERT_KINDS: readonly AlertKind[] = ["floor", "volume", "clear", "listing"];

/** Which kinds each entity type can watch — the brief's table, in one place. */
export const KINDS_FOR: Record<AlertEntityType, readonly AlertKind[]> = {
  identity: ["floor", "clear", "listing"],
  ip: ["volume", "clear"],
  platform: ["volume", "clear"],
};

export type EntityRef = { type: AlertEntityType; key: string; label: string; href: string };

// ── thresholds (named, in one place; copy never types them) ──────────────────

/** A floor move this large, either way, against the floor last fired at. */
export const FLOOR_MOVE_MIN = 0.1;
/** A day's volume at this multiple of the prior seven complete days' mean. */
export const VOLUME_SPIKE_MULTIPLE = 2;
/** The days a volume day is measured against. */
export const VOLUME_BASE_DAYS = 7;
/** An identity clear: a sale at this multiple of the identity's reference. */
export const CLEAR_REFERENCE_MULTIPLE = 3;
/** An ip / platform clear: a single sale at or above this, in USD. */
export const CLEAR_MIN_USD = 1_000;
/** Sales shown in one clear event; the rest are counted. */
export const CLEAR_MAX_LISTED = 5;
