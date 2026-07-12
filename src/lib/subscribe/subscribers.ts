/**
 * report_subscribers store — the ONLY module that touches the subscriber table.
 *
 * ⚠️ SERVER-ONLY, WRITE/CAPTURE PATH. This holds PII (emails). It must NEVER be
 * imported into a public read path, a Server Component that renders public data,
 * or any /api/v1 reader. The only callers are the /api/subscribe + /api/unsubscribe
 * route handlers. The table is RLS-locked (no anon access) as defence in depth.
 *
 * No sending integration (Resend etc.) — that's post-launch. This is capture only.
 */
import { db } from "../db/client";

/** 32 random bytes → 64-char hex. Web Crypto (works in Node + Edge). */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Idempotent subscribe. A brand-new email is inserted with a fresh unsubscribe
 * token; an existing email is REACTIVATED (unsubscribed_at → null) while keeping
 * its ORIGINAL token + created_at, so a previously-issued unsubscribe link never
 * breaks. Race-safe: two concurrent inserts of the same new email → one wins, the
 * other catches the unique violation and falls through to the reactivate update.
 *
 * Never reveals whether the email already existed — the caller returns the same
 * generic success either way.
 */
export async function upsertSubscriber(input: { email: string; source: string }): Promise<void> {
  const { error } = await db().from("report_subscribers").insert({
    email: input.email,
    source: input.source,
    unsubscribe_token: generateToken(),
  });
  if (!error) return; // inserted a new subscriber

  // 23505 = unique_violation on `email` → already subscribed (active or not).
  // Reactivate, refreshing source to the latest touch; leave token + created_at intact.
  if (error.code === "23505") {
    const { error: updErr } = await db()
      .from("report_subscribers")
      .update({ unsubscribed_at: null, source: input.source })
      .eq("email", input.email);
    if (updErr) throw new Error(`[subscribers] reactivate failed: ${updErr.message}`);
    return;
  }
  throw new Error(`[subscribers] insert failed: ${error.message}`);
}

export type UnsubscribeResult = "unsubscribed" | "not_found";

/**
 * Mark a subscriber unsubscribed by token. Idempotent: an already-unsubscribed
 * token still resolves to "unsubscribed" (we keep the ORIGINAL unsubscribe time by
 * only writing when currently active). An unknown token → "not_found".
 */
export async function unsubscribeByToken(token: string): Promise<UnsubscribeResult> {
  // Set the timestamp only for a still-active row (preserves the first unsubscribe time).
  const { data, error } = await db()
    .from("report_subscribers")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("unsubscribe_token", token)
    .is("unsubscribed_at", null)
    .select("id");
  if (error) throw new Error(`[subscribers] unsubscribe failed: ${error.message}`);
  if (data && data.length > 0) return "unsubscribed"; // just unsubscribed

  // No active row updated → token is either bogus or already unsubscribed. One
  // existence check distinguishes "already done" (still a success) from a bad link.
  const { data: row, error: selErr } = await db()
    .from("report_subscribers")
    .select("id")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  if (selErr) throw new Error(`[subscribers] unsubscribe lookup failed: ${selErr.message}`);
  return row ? "unsubscribed" : "not_found";
}
