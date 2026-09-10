-- Canonical set key on `cards`.
--
-- The raw `set_name` is dirty: 2,102 distinct strings for Pokémon alone (measured
-- 2026-09-10 over 152,419 cards), with one set arriving as up to four different
-- strings. src/lib/card/setName.ts is the SSOT that maps a raw value to this key;
-- this column persists its answer so the set leaderboard, the per-set pages and
-- the set indices group on one value instead of re-normalising on every read.
--
-- NULLABLE on purpose: a raw value that resolves to junk ("Game", a bare "SV")
-- has no set, and NULL is the honest answer. Backfilled by
-- scripts/backfill-card-set-key.ts (chunked, resumable, gap-fill only).
alter table public.cards add column if not exists set_key text;

-- The set pages and the warmer both filter (ip_key, set_key); the partial index
-- keeps the junk/unset rows out of it, which is most of the table.
create index if not exists cards_ip_set_key_idx
  on public.cards (ip_key, set_key)
  where set_key is not null;
