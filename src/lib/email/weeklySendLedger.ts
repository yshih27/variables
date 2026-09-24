/**
 * THE WEEKLY SEND LEDGER — who has already been sent a given week's report.
 *
 * One `snapshots` row per report week, `weekly-report-send:<weekStart>`, holding
 * the SUBSCRIBER IDS sent to (never an address: the only PII table is
 * `report_subscribers`, behind `subscribers.ts`). The sender skips every id
 * already in the ledger and appends each id the moment its send succeeds, so a
 * re-run on the same Monday (a retried job, a manual dispatch) sends nobody the
 * report twice, and a run that died halfway picks up where it stopped.
 */
import { readSnapshot, writeSnapshot } from "@/lib/db/snapshots";

export type WeeklySendLedger = {
  weekStart: string;
  /** Subscriber ids the report went to, in send order. */
  sent: string[];
  updatedAt: string;
};

/** "2026-09-14" from any ISO week start. */
export const ledgerWeek = (weekStart: string) => weekStart.slice(0, 10);
export const ledgerKey = (weekStart: string) => `weekly-report-send:${ledgerWeek(weekStart)}`;

export async function readSendLedger(weekStart: string): Promise<WeeklySendLedger> {
  const hit = await readSnapshot<WeeklySendLedger>(ledgerKey(weekStart));
  return hit && Array.isArray(hit.sent) ? hit : { weekStart: ledgerWeek(weekStart), sent: [], updatedAt: new Date(0).toISOString() };
}

export async function writeSendLedger(ledger: WeeklySendLedger): Promise<void> {
  await writeSnapshot(ledgerKey(ledger.weekStart), ledger, ledger.updatedAt);
}

/** Pure: the recipients still owed this week's report, and how many were skipped. */
export function pendingRecipients<T extends { id: string }>(recipients: T[], ledger: WeeklySendLedger): { pending: T[]; skipped: number } {
  const done = new Set(ledger.sent);
  const pending = recipients.filter((r) => !done.has(r.id));
  return { pending, skipped: recipients.length - pending.length };
}

/** Pure: the ledger after one more successful send (idempotent on repeats). */
export function recordSent(ledger: WeeklySendLedger, id: string, at: string): WeeklySendLedger {
  if (ledger.sent.includes(id)) return ledger;
  return { ...ledger, sent: [...ledger.sent, id], updatedAt: at };
}
