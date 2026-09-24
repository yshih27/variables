-- Alerts (bet 3): the Telegram channel. Applied by the orchestrator. Idempotent.
-- RLS ON, no policies; the sole accessor is src/lib/alerts/store.ts.
--
-- Linking: the manage page asks /api/alerts/telegram/start for a deep link; the
-- row gets a one-time `link_code` (15 minutes); the bot's webhook receives
-- `/start <code>`, stores `chat_id`, and clears the code. `chat_id` is null
-- until then. One Telegram chat per subscriber.
create table if not exists public.telegram_links (
  subscriber_id        uuid not null unique references public.report_subscribers (id) on delete cascade,
  chat_id              text,
  link_code            text unique,
  link_code_expires_at timestamptz,
  linked_at            timestamptz
);
alter table public.telegram_links enable row level security;
