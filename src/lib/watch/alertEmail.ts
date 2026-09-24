/**
 * The address an alert was confirmed to, remembered on THIS device so the next
 * "Alert me" is one click — the watchlist's store pattern, localStorage only,
 * read after mount.
 *
 * ⚠️ THE API NEVER SAYS WHETHER AN ADDRESS IS CONFIRMED (its create answer is
 * one sentence for everyone, on purpose). So the device learns it the only
 * honest way: a submit parks the address as PENDING; it is promoted to
 * remembered when this same browser lands from the confirmation link
 * (`/report?alerts=1`) or opens a working manage link. Until then the sheet
 * asks for the address again.
 */
export const ALERT_EMAIL_KEY = "varible:alert-email";
export const ALERT_EMAIL_PENDING_KEY = "varible:alert-email-pending";

function read(key: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as { email?: unknown }) : null;
    return typeof v?.email === "string" ? v.email : null;
  } catch {
    return null;
  }
}

function write(key: string, email: string | null): void {
  try {
    if (email) localStorage.setItem(key, JSON.stringify({ email }));
    else localStorage.removeItem(key);
  } catch {
    /* storage blocked — the sheet just asks again */
  }
}

/** The confirmed address remembered here, if any. */
export const readAlertEmail = (): string | null => read(ALERT_EMAIL_KEY);

/** A submit that went through: park the address until its confirmation lands here. */
export const rememberPendingAlertEmail = (email: string): void => write(ALERT_EMAIL_PENDING_KEY, email);

/** The confirmation (or a working manage link) landed on this device: remember the parked address. */
export function promotePendingAlertEmail(): void {
  const pending = read(ALERT_EMAIL_PENDING_KEY);
  if (!pending) return;
  write(ALERT_EMAIL_KEY, pending);
  write(ALERT_EMAIL_PENDING_KEY, null);
}

export function forgetAlertEmail(): void {
  write(ALERT_EMAIL_KEY, null);
}
