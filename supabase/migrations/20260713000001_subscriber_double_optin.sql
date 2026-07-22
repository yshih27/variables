-- Double opt-in for report_subscribers (post-launch: Resend wiring).
-- A subscriber receives the weekly report ONLY when
--   confirmed_at IS NOT NULL AND unsubscribed_at IS NULL.
-- New signups land pending (confirmed_at null) and activate by clicking the
-- confirmation link (→ /api/confirm?token=confirm_token). Idempotent; RLS is
-- inherited from the base table (enabled, no policies — anon gets nothing).

alter table public.report_subscribers
  add column if not exists confirm_token text,
  add column if not exists confirmed_at  timestamptz;

-- Unique confirmation token. Nullable → multiple NULLs are allowed by a Postgres
-- unique index, so unconfirmed rows without a token (shouldn't happen) don't clash.
create unique index if not exists report_subscribers_confirm_token_key
  on public.report_subscribers (confirm_token);

-- Grandfather subscribers captured BEFORE double opt-in existed: they gave
-- affirmative consent via the signup form (single opt-in), so mark them confirmed.
-- Rows written by the old single-opt-in code are exactly those with NO
-- confirm_token (the double-opt-in code always issues one), regardless of when
-- they signed up — so this stays idempotent: re-running never confirms a
-- genuinely-pending signup, which always carries a token. After deploying the
-- double-opt-in code, run this UPDATE once more to catch rows the old code wrote
-- in the gap. (Counsel may override; safe default = keep them.)
update public.report_subscribers set confirmed_at = created_at
  where confirmed_at is null and confirm_token is null;
