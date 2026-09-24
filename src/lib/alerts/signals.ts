/**
 * THE SIGNALS — pure functions that NOTICE a number the site already computes
 * moving. Nothing here computes a new number: a floor is the identity page's
 * floor (plausible asks only), a reference is the page's reference (latest
 * complete month), a volume is the spine's source-complete day.
 *
 * Every signal reads an entity READING (built once per entity per run, from one
 * read of each source: readings.ts) and the subscription's own STATE (what it
 * last fired at / last saw), and returns the event to fire, if any, and the
 * state to keep. Every payload carries each figure WITH its window and source;
 * the templates may print only what a payload carries (render.ts, and a test
 * that asserts it on the rendered text).
 *
 * A signal's FIRST look at a subscription is a baseline: it records what it
 * sees and fires nothing, so a new watch does not open with "floor appeared".
 */
import { DELTA_MIN_BASE_USD } from "@/lib/data/metricSnapshots";
import { askInBand } from "@/lib/card/identityView";

// The kinds and thresholds live in the import-free leaf `rules.ts` (so the
// client can print them); re-exported here so every existing import holds.
export * from "./rules";
import type { AlertKind, EntityRef } from "./rules";
import { FLOOR_MOVE_MIN, VOLUME_SPIKE_MULTIPLE, VOLUME_BASE_DAYS, CLEAR_REFERENCE_MULTIPLE, CLEAR_MIN_USD, CLEAR_MAX_LISTED } from "./rules";

// ── readings (one per entity per run) ────────────────────────────────────────

export type IdentityReading = {
  entity: EntityRef;
  /** The page's floor: the cheapest live ask, and whether the page would headline it. */
  floor: { priceUsd: number; venue: string; plausible: boolean } | null;
  /** The page's reference price: the latest COMPLETE month's median. */
  reference: { priceUsd: number; month: string; n: number } | null;
  lastSale: { priceUsd: number; ts: string } | null;
  /** Live asks on the identity's slabs. */
  listed: { cardId: string; venue: string; priceUsd: number; source: string }[];
  /** The listings snapshot these asks come from. */
  listingsAsOf: string;
};

export type VolumeReading = {
  entity: EntityRef;
  /** The last SOURCE-COMPLETE UTC day (INV-8), ISO day start. */
  day: string;
  totalUsd: number;
  resaleUsd: number;
  /** Pack spend (gacha; the Claw on Beezie). Null for an IP: packs carry no IP. */
  packsUsd: number | null;
  /** Mean daily total over the seven complete days before `day`. */
  meanUsd: number;
  window: { from: string; to: string; days: number };
};

export type SaleRef = {
  cardId: string;
  name: string | null;
  venue: string;
  priceUsd: number;
  ts: string;
  identitySlug: string | null;
  ip: string | null;
};

// ── events ───────────────────────────────────────────────────────────────────

export type FloorPayload = {
  change: "moved" | "appeared" | "disappeared";
  from: { priceUsd: number; venue: string; at: string } | null;
  to: { priceUsd: number; venue: string } | null;
  /** (to − from) ÷ from × 100, when both exist. */
  pct: number | null;
  reference: IdentityReading["reference"];
  source: { listingsAsOf: string };
};
export type VolumePayload = VolumeReading & { multiple: number; source: "spine" };
export type ClearPayload = {
  sales: SaleRef[];
  /** Sales that qualified beyond the listed ones. */
  more: number;
  rule:
    | { kind: "reference"; multiple: number; reference: NonNullable<IdentityReading["reference"]> }
    | { kind: "min-usd"; minUsd: number };
  /** Each listed sale's multiple of the reference (identity rule only). */
  multiples: number[] | null;
  source: { storeAsOf: string };
};
export type ListingPayload = {
  listings: { cardId: string; venue: string; priceUsd: number; source: string; plausible: boolean; vsReference: number | null }[];
  /** What each ask was judged against: the monthly reference, else the last sale. */
  basis: { kind: "reference"; priceUsd: number; month: string } | { kind: "last-sale"; priceUsd: number; ts: string } | null;
  source: { listingsAsOf: string };
};

export type AlertEvent =
  | { kind: "floor"; entity: EntityRef; payload: FloorPayload }
  | { kind: "volume"; entity: EntityRef; payload: VolumePayload }
  | { kind: "clear"; entity: EntityRef; payload: ClearPayload }
  | { kind: "listing"; entity: EntityRef; payload: ListingPayload };

export type SignalResult<S> = { event: AlertEvent | null; state: S };

// ── floor ────────────────────────────────────────────────────────────────────

export type FloorState = { priceUsd: number | null; venue: string | null; at: string };

export function floorSignal(r: IdentityReading, prev: FloorState | undefined, now: string): SignalResult<FloorState> {
  // Only a plausible ask is a floor. A $1 placeholder is "no floor".
  const cur = r.floor?.plausible ? { priceUsd: r.floor.priceUsd, venue: r.floor.venue } : null;
  const next: FloorState = { priceUsd: cur?.priceUsd ?? null, venue: cur?.venue ?? null, at: now };
  if (!prev) return { event: null, state: next }; // baseline
  const was = prev.priceUsd != null && prev.venue != null ? { priceUsd: prev.priceUsd, venue: prev.venue, at: prev.at } : null;
  let change: FloorPayload["change"] | null = null;
  let pct: number | null = null;
  if (!was && cur) change = "appeared";
  else if (was && !cur) change = "disappeared";
  else if (was && cur) {
    pct = ((cur.priceUsd - was.priceUsd) / was.priceUsd) * 100;
    if (Math.abs(pct) >= FLOOR_MOVE_MIN * 100) change = "moved";
  }
  // Compared against the floor LAST FIRED AT: drift below the threshold keeps
  // the old state, so three 4% steps fire on the third.
  if (!change) return { event: null, state: prev };
  return {
    event: {
      kind: "floor",
      entity: r.entity,
      payload: { change, from: was, to: cur, pct: change === "moved" ? pct : null, reference: r.reference, source: { listingsAsOf: r.listingsAsOf } },
    },
    state: next,
  };
}

// ── volume ───────────────────────────────────────────────────────────────────

export type VolumeState = { lastDay: string | null };

export function volumeSignal(r: VolumeReading | null, prev: VolumeState | undefined): SignalResult<VolumeState> {
  const state = prev ?? { lastDay: null };
  if (!r || r.window.days < VOLUME_BASE_DAYS) return { event: null, state };
  // The noise floor: a spike off a near-zero base is not news.
  if (!(r.meanUsd >= DELTA_MIN_BASE_USD)) return { event: null, state };
  const multiple = r.totalUsd / r.meanUsd;
  if (multiple < VOLUME_SPIKE_MULTIPLE) return { event: null, state };
  // A complete day is judged once: a lagging next day must not re-fire it tomorrow.
  if (state.lastDay === r.day) return { event: null, state };
  return { event: { kind: "volume", entity: r.entity, payload: { ...r, multiple, source: "spine" } }, state: { lastDay: r.day } };
}

// ── clear ────────────────────────────────────────────────────────────────────

export type ClearState = { cursor: string };

/**
 * `sales` are the entity's sales in the store (already joined: an identity's by
 * slug, an ip's by the card row's ip, a platform's by venue). Only sales after
 * the subscription's cursor count; the cursor then moves to the newest sale
 * seen, so a sale is judged once.
 */
export function clearSignal(
  entity: EntityRef,
  sales: SaleRef[],
  reference: IdentityReading["reference"] | null,
  prev: ClearState | undefined,
  storeAsOf: string,
): SignalResult<ClearState> {
  const newest = sales.reduce((m, s) => (s.ts > m ? s.ts : m), prev?.cursor ?? "");
  const state: ClearState = { cursor: newest || storeAsOf };
  if (!prev) return { event: null, state }; // baseline
  const fresh = sales.filter((s) => s.ts > prev.cursor);
  let rule: ClearPayload["rule"];
  let hits: SaleRef[];
  if (entity.type === "identity") {
    // Measured against the reference or not at all: no reference, no clear.
    if (!reference || !(reference.priceUsd > 0)) return { event: null, state };
    rule = { kind: "reference", multiple: CLEAR_REFERENCE_MULTIPLE, reference };
    hits = fresh.filter((s) => s.priceUsd >= CLEAR_REFERENCE_MULTIPLE * reference.priceUsd);
  } else {
    rule = { kind: "min-usd", minUsd: CLEAR_MIN_USD };
    hits = fresh.filter((s) => s.priceUsd >= CLEAR_MIN_USD);
  }
  if (!hits.length) return { event: null, state };
  const top = [...hits].sort((a, b) => b.priceUsd - a.priceUsd || a.ts.localeCompare(b.ts)).slice(0, CLEAR_MAX_LISTED);
  return {
    event: {
      kind: "clear",
      entity,
      payload: {
        sales: top,
        more: hits.length - top.length,
        rule,
        multiples: rule.kind === "reference" ? top.map((s) => s.priceUsd / rule.reference.priceUsd) : null,
        source: { storeAsOf },
      },
    },
    state,
  };
}

// ── listing ──────────────────────────────────────────────────────────────────

export type ListingState = { seen: string[] };

export function listingSignal(r: IdentityReading, prev: ListingState | undefined): SignalResult<ListingState> {
  const state: ListingState = { seen: r.listed.map((l) => l.cardId).sort() };
  if (!prev) return { event: null, state }; // baseline
  const seen = new Set(prev.seen);
  const fresh = r.listed.filter((l) => !seen.has(l.cardId));
  if (!fresh.length) return { event: null, state };
  const basis: ListingPayload["basis"] = r.reference
    ? { kind: "reference", priceUsd: r.reference.priceUsd, month: r.reference.month }
    : r.lastSale
      ? { kind: "last-sale", priceUsd: r.lastSale.priceUsd, ts: r.lastSale.ts }
      : null;
  return {
    event: {
      kind: "listing",
      entity: r.entity,
      payload: {
        listings: [...fresh]
          .sort((a, b) => a.priceUsd - b.priceUsd || a.cardId.localeCompare(b.cardId))
          .map((l) => ({
            ...l,
            // The page's band: an aggregator placeholder is an unverified ask.
            plausible: askInBand(l.priceUsd, basis?.priceUsd),
            vsReference: basis && basis.priceUsd > 0 ? l.priceUsd / basis.priceUsd : null,
          })),
        basis,
        source: { listingsAsOf: r.listingsAsOf },
      },
    },
    state,
  };
}

// ── dedupe + digest ──────────────────────────────────────────────────────────

/** "2026-09-24" — the UTC day an event belongs to. */
export const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/** One event per kind per entity per subscription per UTC day. */
export function fingerprint(subscriptionId: string, kind: AlertKind, entity: Pick<EntityRef, "type" | "key">, at: string): string {
  return `${subscriptionId}:${kind}:${entity.type}:${entity.key}:${utcDay(at)}`;
}

/** How big a move is, for ordering a digest and naming its biggest move. */
export function magnitude(e: AlertEvent): number {
  switch (e.kind) {
    case "floor":
      return e.payload.pct != null ? Math.abs(e.payload.pct) : 100;
    case "volume":
      return (e.payload.multiple - 1) * 100;
    case "clear":
      return e.payload.multiples ? (Math.max(...e.payload.multiples) - 1) * 100 : (e.payload.sales[0].priceUsd / CLEAR_MIN_USD - 1) * 100;
    case "listing":
      return 0;
  }
}

export type FiredEvent = AlertEvent & { subscriptionId: string; fingerprint: string; firedAt: string };
export type Digest = { subscriberId: string; channel: "email" | "telegram"; events: FiredEvent[] };

/** ONE digest per subscriber per channel per run, biggest move first. */
export function composeDigests(events: FiredEvent[], subscriptionOf: (id: string) => { subscriberId: string; channel: "email" | "telegram" } | undefined): Digest[] {
  const byKey = new Map<string, Digest>();
  for (const e of events) {
    const s = subscriptionOf(e.subscriptionId);
    if (!s) continue;
    const k = `${s.subscriberId}:${s.channel}`;
    const d = byKey.get(k) ?? byKey.set(k, { subscriberId: s.subscriberId, channel: s.channel, events: [] }).get(k)!;
    d.events.push(e);
  }
  for (const d of byKey.values()) d.events.sort((a, b) => magnitude(b) - magnitude(a) || a.fingerprint.localeCompare(b.fingerprint));
  return [...byKey.values()].sort((a, b) => a.subscriberId.localeCompare(b.subscriberId) || a.channel.localeCompare(b.channel));
}
