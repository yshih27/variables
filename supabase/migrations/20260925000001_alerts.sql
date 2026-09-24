-- Alerts (bet 3): watches that write. Applied by the orchestrator, never by an
-- executor. Idempotent (if not exists everywhere). RLS ON with NO policies on
-- every table: the anon / publishable key reads nothing; only the server
-- (service role) touches these, through ONE accessor module each:
--   report_subscribers.manage_token → src/lib/subscribe/subscribers.ts
--   alert_subscriptions / alert_state / alert_events → src/lib/alerts/store.ts
-- Every alert row hangs off a subscriber and CASCADES with it, so
-- SUBSCRIBER_UNSUBSCRIBE_MODE=delete removes a reader's watches, state and
-- events in the same statement that removes the reader.

-- The link a reader manages their alerts by. Issued on the first watch; never
-- the unsubscribe token (that one sits in every email's headers).
alter table public.report_subscribers
  add column if not exists manage_token text;
create unique index if not exists report_subscribers_manage_token_key
  on public.report_subscribers (manage_token);

create table if not exists public.alert_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.report_subscribers (id) on delete cascade,
  entity_type   text not null check (entity_type in ('identity', 'ip', 'platform')),
  -- an identity slug (ip/set/number/name/grade[/edition][/lang]), an ip key, a platform key
  entity_key    text not null check (length(entity_key) between 1 and 300),
  kinds         text[] not null check (
                  cardinality(kinds) between 1 and 4
                  and kinds <@ array['floor', 'volume', 'clear', 'listing']::text[]
                ),
  channel       text not null check (channel in ('email', 'telegram')),
  created_at    timestamptz not null default now(),
  paused_at     timestamptz,
  unique (subscriber_id, entity_type, entity_key, channel)
);
create index if not exists alert_subscriptions_active_idx
  on public.alert_subscriptions (entity_type, entity_key) where paused_at is null;
alter table public.alert_subscriptions enable row level security;

-- What a subscription last saw: the floor it last fired at, the listing set it
-- last saw, the sale cursor, the volume day it last fired for.
create table if not exists public.alert_state (
  subscription_id uuid not null references public.alert_subscriptions (id) on delete cascade,
  key             text not null,
  value           jsonb not null,
  updated_at      timestamptz not null default now(),
  primary key (subscription_id, key)
);
alter table public.alert_state enable row level security;

-- One row per fired alert. `fingerprint` = <subscription>:<kind>:<entity>:<UTC day>
-- is the dedupe: one event per kind per entity per subscriber per day.
create table if not exists public.alert_events (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.alert_subscriptions (id) on delete cascade,
  kind            text not null check (kind in ('floor', 'volume', 'clear', 'listing')),
  fingerprint     text not null unique,
  payload         jsonb not null,
  fired_at        timestamptz not null default now(),
  sent_at         timestamptz
);
create index if not exists alert_events_unsent_idx on public.alert_events (fired_at) where sent_at is null;
alter table public.alert_events enable row level security;
