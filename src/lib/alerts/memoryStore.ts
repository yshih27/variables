/**
 * An in-memory `AlertStore` — the fixture run (`run-alerts --fixture`) and the
 * unit tests drive the real run against it, and it serialises to JSON so a
 * second fixture run can pick up where the first left off (the dedupe proof)
 * without a table anywhere.
 */
import type { AlertStore, AlertSubscription, EventRow } from "./store";

export type MemoryAlertData = {
  subscriptions: AlertSubscription[];
  state: Record<string, Record<string, unknown>>;
  events: (EventRow & { id: string; sentAt: string | null })[];
  telegram: Record<string, string>;
};

export function memoryAlertStore(data: MemoryAlertData): AlertStore & { data: MemoryAlertData } {
  let seq = data.events.length;
  return {
    data,
    async listActiveSubscriptions() {
      return data.subscriptions.filter((s) => !s.pausedAt);
    },
    async readStates(ids) {
      const out = new Map<string, Map<string, unknown>>();
      for (const id of ids) if (data.state[id]) out.set(id, new Map(Object.entries(data.state[id])));
      return out;
    },
    async writeStates(rows) {
      for (const r of rows) (data.state[r.subscriptionId] ??= {})[r.key] = r.value;
    },
    async existingFingerprints(fps) {
      const have = new Set(data.events.map((e) => e.fingerprint));
      return new Set(fps.filter((f) => have.has(f)));
    },
    async insertEvents(rows) {
      const out = new Map<string, string>();
      const have = new Set(data.events.map((e) => e.fingerprint));
      for (const r of rows) {
        if (have.has(r.fingerprint)) continue;
        const id = `evt-${++seq}`;
        data.events.push({ ...r, id, sentAt: null });
        have.add(r.fingerprint);
        out.set(r.fingerprint, id);
      }
      return out;
    },
    async markSent(ids, at) {
      const set = new Set(ids);
      for (const e of data.events) if (set.has(e.id)) e.sentAt = at;
    },
    async telegramChats(ids) {
      return new Map(ids.filter((id) => data.telegram[id]).map((id) => [id, data.telegram[id]]));
    },
  };
}

export const emptyMemoryData = (subscriptions: AlertSubscription[] = []): MemoryAlertData => ({ subscriptions, state: {}, events: [], telegram: {} });
