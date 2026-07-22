/**
 * report_subscribers store — the ONLY module that touches the subscriber table.
 *
 * ⚠️ SERVER-ONLY, holds PII (emails). NEVER import into a public read path, a
 * Server Component that renders public data, or any /api/v1 reader. Callers are the
 * /api/subscribe, /api/confirm, /api/unsubscribe routes and scripts/send-weekly-report.
 *
 * Lifecycle (double opt-in):
 *   subscribe → row is PENDING (confirmed_at null) + a confirm_token → confirmation
 *   email sent → user clicks → confirmed_at set (ACTIVE) → ... → unsubscribed_at set.
 * A subscriber receives the report only when confirmed_at != null AND unsubscribed_at
 * == null. RLS-locked (no anon access) as defence in depth.
 */
import { db } from "../db/client";

/** 32 random bytes → 64-char hex. Web Crypto (works in Node + Edge). */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type SubscribeResult =
  /** A confirmation email should be sent with these tokens (confirm CTA + unsubscribe header). */
  | { action: "confirm"; confirmToken: string; unsubscribeToken: string }
  /** Already confirmed + active — no email, no change (idempotent). */
  | { action: "already_active" };

async function reissue(email: string, source: string, confirmToken: string): Promise<void> {
  const { error } = await db()
    .from("report_subscribers")
    .update({ source, confirm_token: confirmToken, confirmed_at: null, unsubscribed_at: null })
    .eq("email", email);
  if (error) throw new Error(`[subscribers] re-issue failed: ${error.message}`);
}

/**
 * Double opt-in subscribe. Returns whether a confirmation email is needed:
 *   • new / pending / previously-unsubscribed  → reset to PENDING, fresh confirm_token
 *     (a truly new row also gets a fresh unsubscribe_token); caller emails the link.
 *   • already confirmed + active               → no-op, no email.
 * The route returns the SAME generic success either way, so existence never leaks.
 * Race-safe: a concurrent insert of a new email → one wins, the other 23505s and
 * falls through to the update path.
 */
export async function subscribeEmail(input: { email: string; source: string }): Promise<SubscribeResult> {
  const { email, source } = input;
  const existing = await db()
    .from("report_subscribers")
    .select("confirmed_at, unsubscribed_at, unsubscribe_token")
    .eq("email", email)
    .maybeSingle();
  if (existing.error) throw new Error(`[subscribers] lookup failed: ${existing.error.message}`);

  const row = existing.data as
    | { confirmed_at: string | null; unsubscribed_at: string | null; unsubscribe_token: string }
    | null;
  if (row && row.confirmed_at && !row.unsubscribed_at) {
    return { action: "already_active" }; // already subscribed — send nothing
  }

  const confirmToken = generateToken();
  if (!row) {
    const unsubscribeToken = generateToken();
    const { error } = await db().from("report_subscribers").insert({
      email,
      source,
      unsubscribe_token: unsubscribeToken,
      confirm_token: confirmToken,
      confirmed_at: null,
      unsubscribed_at: null,
    });
    if (!error) return { action: "confirm", confirmToken, unsubscribeToken };
    if (error.code !== "23505") throw new Error(`[subscribers] insert failed: ${error.message}`);
    // race: someone inserted between our read and write → re-read its token + update.
    // Must NOT fall back to our unsubscribeToken — it was never persisted, so an
    // email built with it would carry a dead unsubscribe link.
    const reread = await db()
      .from("report_subscribers")
      .select("unsubscribe_token")
      .eq("email", email)
      .maybeSingle();
    if (reread.error) throw new Error(`[subscribers] race re-read failed: ${reread.error.message}`);
    await reissue(email, source, confirmToken);
    return { action: "confirm", confirmToken, unsubscribeToken: (reread.data?.unsubscribe_token as string) ?? unsubscribeToken };
  }

  // Existing pending / unsubscribed → re-issue confirmation, keep its unsubscribe_token.
  await reissue(email, source, confirmToken);
  return { action: "confirm", confirmToken, unsubscribeToken: row.unsubscribe_token };
}

export type ConfirmResult = "confirmed" | "already_confirmed" | "not_found";

/**
 * Activate a subscription by confirm token. Idempotent — a second click on an
 * already-confirmed token returns "already_confirmed". Confirming also clears any
 * `unsubscribed_at` (the click IS a fresh opt-in). Unknown token → "not_found".
 */
export async function confirmSubscriber(token: string): Promise<ConfirmResult> {
  const { data, error } = await db()
    .from("report_subscribers")
    .update({ confirmed_at: new Date().toISOString(), unsubscribed_at: null })
    .eq("confirm_token", token)
    .is("confirmed_at", null)
    .select("id");
  if (error) throw new Error(`[subscribers] confirm failed: ${error.message}`);
  if (data && data.length > 0) return "confirmed";

  // No pending row updated → token bogus or already confirmed. Distinguish.
  const { data: row, error: selErr } = await db()
    .from("report_subscribers")
    .select("confirmed_at")
    .eq("confirm_token", token)
    .maybeSingle();
  if (selErr) throw new Error(`[subscribers] confirm lookup failed: ${selErr.message}`);
  if (!row) return "not_found";
  return "already_confirmed";
}

export type UnsubscribeResult = "unsubscribed" | "not_found";

/**
 * Unsubscribe by token. Retention is controlled by SUBSCRIBER_UNSUBSCRIBE_MODE:
 *   • "mark" (DEFAULT) — set unsubscribed_at, keep the row (current behavior).
 *   • "delete"        — hard-delete the row (the privacy page's proposed policy).
 * ⚠️ Leave the default as "mark" until counsel sets retention; then flip the env
 * (or this default). "delete" is destructive: a re-click of a deleted token → "not_found".
 */
export async function unsubscribeByToken(token: string): Promise<UnsubscribeResult> {
  const mode = process.env.SUBSCRIBER_UNSUBSCRIBE_MODE === "delete" ? "delete" : "mark";

  if (mode === "delete") {
    const { data, error } = await db()
      .from("report_subscribers")
      .delete()
      .eq("unsubscribe_token", token)
      .select("id");
    if (error) throw new Error(`[subscribers] unsubscribe(delete) failed: ${error.message}`);
    return data && data.length > 0 ? "unsubscribed" : "not_found";
  }

  // mark mode — set the timestamp only for a still-active row (preserve the first time).
  const { data, error } = await db()
    .from("report_subscribers")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("unsubscribe_token", token)
    .is("unsubscribed_at", null)
    .select("id");
  if (error) throw new Error(`[subscribers] unsubscribe failed: ${error.message}`);
  if (data && data.length > 0) return "unsubscribed";

  const { data: row, error: selErr } = await db()
    .from("report_subscribers")
    .select("id")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  if (selErr) throw new Error(`[subscribers] unsubscribe lookup failed: ${selErr.message}`);
  return row ? "unsubscribed" : "not_found";
}

export type ConfirmedSubscriber = { email: string; unsubscribeToken: string };

/**
 * All ACTIVE recipients for the weekly broadcast: confirmed AND not unsubscribed.
 * Paginated (PostgREST caps at 1000/page). Read path is scripts/send-weekly-report.
 */
export async function listConfirmedSubscribers(): Promise<ConfirmedSubscriber[]> {
  const PAGE = 1000;
  const out: ConfirmedSubscriber[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("report_subscribers")
      .select("email, unsubscribe_token")
      .not("confirmed_at", "is", null)
      .is("unsubscribed_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }) // stable tiebreak — equal timestamps can't duplicate/skip across pages
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`[subscribers] list confirmed failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) out.push({ email: r.email as string, unsubscribeToken: r.unsubscribe_token as string });
    if (rows.length < PAGE) break;
  }
  return out;
}
