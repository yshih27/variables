/**
 * A notifier delivers ONE digest to ONE reader on ONE channel. The run never
 * knows how; it hands over the digest and records `sent_at` when this answers ok.
 */
import type { Digest } from "@/lib/alerts/signals";

export type Recipient = {
  subscriberId: string;
  email: string;
  unsubscribeToken: string;
  manageToken: string;
  telegramChatId: string | null;
};

export type NotifyResult = { ok: true; delivered: boolean } | { ok: false; error: string };

export interface Notifier {
  channel: "email" | "telegram";
  /** False when this deployment cannot deliver on the channel (no key). */
  available: boolean;
  send(recipient: Recipient, digest: Digest): Promise<NotifyResult>;
}
