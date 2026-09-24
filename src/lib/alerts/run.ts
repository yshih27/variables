/**
 * ONE ALERT RUN — load the watches, read every source once, evaluate every
 * signal once per entity, dedupe, compose ONE digest per reader per channel,
 * hand it to the notifier, record `sent_at`.
 *
 * Written against seams (the store, the recipient directory, the readings
 * loader, the notifiers), so the dry run, the fixture run, the unit tests and
 * the real `--send` are the same code. Dry run (`send: false`): nothing is
 * inserted, no state is written, nothing is sent; the report says what WOULD
 * fire and to whom (by subscriber position, never an address).
 *
 * STATE: a subscription's state moves when its signal says so, EXCEPT when the
 * event it would fire was deduped (already fired today): then the old state is
 * kept, so "the floor last fired at" stays the floor that actually fired.
 */
import {
  clearSignal,
  composeDigests,
  fingerprint,
  floorSignal,
  KINDS_FOR,
  listingSignal,
  volumeSignal,
  type AlertEvent,
  type AlertEntityType,
  type AlertKind,
  type ClearState,
  type Digest,
  type EntityRef,
  type FiredEvent,
  type FloorState,
  type ListingState,
  type VolumeState,
} from "./signals";
import type { AlertChannel, AlertStore, AlertSubscription, StateRow } from "./store";
import type { Readings } from "./readings";
import type { Notifier, Recipient } from "@/lib/notify/types";

export type DirectoryEntry = Omit<Recipient, "telegramChatId" | "manageToken"> & { manageToken: string | null };

export type RunDeps = {
  store: AlertStore;
  /** CONFIRMED, active readers among these ids (subscribers.ts `listAlertRecipients`). */
  directory(subscriberIds: string[]): Promise<Map<string, DirectoryEntry>>;
  /** Issue (or read) a reader's manage token — send mode only. */
  ensureManageToken?(subscriberId: string): Promise<string>;
  resolve(type: AlertEntityType, key: string): EntityRef | null;
  readings(entities: EntityRef[]): Promise<Readings>;
  notifiers: Partial<Record<AlertChannel, Notifier>>;
  now: string;
  send: boolean;
};

export type RunReport = {
  subscriptions: number;
  /** Watches whose reader is confirmed and active. */
  active: number;
  entities: { identity: number; ip: number; platform: number };
  fired: Record<AlertKind, number>;
  deduped: number;
  digests: { subscriber: number; channel: AlertChannel; events: number; subject?: string }[];
  sent: number;
  failed: number;
  undeliverable: number;
  statesWritten: number;
  events: FiredEvent[];
  rendered: Digest[];
  timings: Record<string, number>;
};

type States = Map<string, Map<string, unknown>>;

function evaluate(sub: AlertSubscription, kind: AlertKind, entity: EntityRef, r: Readings, state: Map<string, unknown> | undefined, now: string): { event: AlertEvent | null; state: unknown } | null {
  const prev = state?.get(kind);
  switch (kind) {
    case "floor": {
      const reading = r.identities.get(sub.entityKey);
      return reading ? floorSignal(reading, prev as FloorState | undefined, now) : null;
    }
    case "listing": {
      const reading = r.identities.get(sub.entityKey);
      return reading ? listingSignal(reading, prev as ListingState | undefined) : null;
    }
    case "volume":
      return volumeSignal(r.volumes.get(`${sub.entityType}:${sub.entityKey}`) ?? null, prev as VolumeState | undefined);
    case "clear": {
      if (!r.sales.storeAsOf) return null;
      const list =
        sub.entityType === "identity" ? r.sales.byIdentity.get(sub.entityKey) : sub.entityType === "ip" ? r.sales.byIp.get(sub.entityKey) : r.sales.byPlatform.get(sub.entityKey);
      const reference = sub.entityType === "identity" ? (r.identities.get(sub.entityKey)?.reference ?? null) : null;
      if (sub.entityType === "identity" && !r.identities.has(sub.entityKey)) return null;
      return clearSignal(entity, list ?? [], reference, prev as ClearState | undefined, r.sales.storeAsOf);
    }
  }
}

export async function runAlerts(deps: RunDeps): Promise<RunReport> {
  const timings: Record<string, number> = {};
  const t0 = Date.now();
  const all = await deps.store.listActiveSubscriptions();
  const directory = await deps.directory([...new Set(all.map((s) => s.subscriberId))]);
  const subs = all.filter((s) => directory.has(s.subscriberId));
  timings.load = Date.now() - t0;

  // Entities, once each, resolved to their labels and pages.
  const entityOf = new Map<string, EntityRef>();
  for (const s of subs) {
    const k = `${s.entityType}:${s.entityKey}`;
    if (!entityOf.has(k)) {
      const e = deps.resolve(s.entityType, s.entityKey);
      if (e) entityOf.set(k, e);
    }
  }
  const t1 = Date.now();
  const readings = await deps.readings([...entityOf.values()]);
  timings.readings = Date.now() - t1;
  Object.assign(timings, Object.fromEntries(Object.entries(readings.timings).map(([k, v]) => [`read:${k}`, v])));

  const t2 = Date.now();
  const states: States = await deps.store.readStates(subs.map((s) => s.id));
  const candidates: { sub: AlertSubscription; event: FiredEvent | null; kind: AlertKind; next: unknown; prev: unknown }[] = [];
  for (const sub of subs) {
    const entity = entityOf.get(`${sub.entityType}:${sub.entityKey}`);
    if (!entity) continue;
    for (const kind of sub.kinds) {
      if (!KINDS_FOR[sub.entityType].includes(kind)) continue;
      const res = evaluate(sub, kind, entity, readings, states.get(sub.id), deps.now);
      if (!res) continue;
      const fired: FiredEvent | null = res.event
        ? { ...res.event, subscriptionId: sub.id, fingerprint: fingerprint(sub.id, kind, entity, deps.now), firedAt: deps.now }
        : null;
      candidates.push({ sub, kind, event: fired, next: res.state, prev: states.get(sub.id)?.get(kind) });
    }
  }
  const already = await deps.store.existingFingerprints(candidates.flatMap((c) => (c.event ? [c.event.fingerprint] : [])));
  const fresh = candidates.flatMap((c) => (c.event && !already.has(c.event.fingerprint) ? [c.event] : []));
  const deduped = candidates.filter((c) => c.event && already.has(c.event.fingerprint)).length;
  const stateRows: StateRow[] = candidates
    .filter((c) => !(c.event && already.has(c.event.fingerprint)))
    .filter((c) => JSON.stringify(c.next) !== JSON.stringify(c.prev))
    .map((c) => ({ subscriptionId: c.sub.id, key: c.kind, value: c.next }));
  timings.evaluate = Date.now() - t2;

  const subOf = new Map(subs.map((s) => [s.id, s]));
  const digests = composeDigests(fresh, (id) => {
    const s = subOf.get(id);
    return s ? { subscriberId: s.subscriberId, channel: s.channel } : undefined;
  });
  const position = new Map([...directory.keys()].map((id, i) => [id, i + 1]));

  const fired = { floor: 0, volume: 0, clear: 0, listing: 0 } as Record<AlertKind, number>;
  for (const e of fresh) fired[e.kind]++;
  const report: RunReport = {
    subscriptions: all.length,
    active: subs.length,
    entities: {
      identity: [...entityOf.values()].filter((e) => e.type === "identity").length,
      ip: [...entityOf.values()].filter((e) => e.type === "ip").length,
      platform: [...entityOf.values()].filter((e) => e.type === "platform").length,
    },
    fired,
    deduped,
    digests: digests.map((d) => ({ subscriber: position.get(d.subscriberId) ?? 0, channel: d.channel, events: d.events.length })),
    sent: 0,
    failed: 0,
    undeliverable: 0,
    statesWritten: 0,
    events: fresh,
    rendered: digests,
    timings,
  };
  if (!deps.send) {
    timings.total = Date.now() - t0;
    return report;
  }

  // ── send ──
  const t3 = Date.now();
  const ids = await deps.store.insertEvents(fresh.map((e) => ({ subscriptionId: e.subscriptionId, kind: e.kind, fingerprint: e.fingerprint, payload: e.payload, firedAt: e.firedAt })));
  await deps.store.writeStates(stateRows);
  report.statesWritten = stateRows.length;
  const chats = digests.some((d) => d.channel === "telegram") ? await deps.store.telegramChats(digests.map((d) => d.subscriberId)) : new Map<string, string>();
  for (const d of digests) {
    const n = deps.notifiers[d.channel];
    const who = directory.get(d.subscriberId)!;
    if (!n?.available) {
      report.undeliverable++;
      continue;
    }
    const manageToken = who.manageToken ?? (deps.ensureManageToken ? await deps.ensureManageToken(d.subscriberId) : null);
    if (!manageToken) {
      report.failed++;
      continue;
    }
    // Only this run's inserts are sent: a concurrent run that won a fingerprint sends its own.
    const mine = { ...d, events: d.events.filter((e) => ids.has(e.fingerprint)) };
    if (!mine.events.length) continue;
    const res = await n.send({ ...who, manageToken, telegramChatId: chats.get(d.subscriberId) ?? null }, mine);
    if (res.ok) {
      report.sent++;
      await deps.store.markSent(mine.events.map((e) => ids.get(e.fingerprint)!), new Date().toISOString());
    } else report.failed++;
  }
  timings.send = Date.now() - t3;
  timings.total = Date.now() - t0;
  return report;
}
