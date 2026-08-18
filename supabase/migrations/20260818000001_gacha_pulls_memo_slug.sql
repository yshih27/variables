-- memo_slug on gacha_pulls — the originating partner/surface of a pull.
--
-- Collector Crypt's winners feed carries `memo_slug` on every row (verified live
-- 2026-08-18: values include 'cc', 'jupiter', 'comic', 'sol', 'slabz', 'watch',
-- 'glyde', 'roll'; 'rare' is the Rarible-originated channel). It identifies which
-- partner surface a pull was bought through, which is the only way to segment
-- gacha volume by origin — the on-chain USDC transfer carries no such marker.
--
-- ⚠️ FORWARD-ONLY. This column starts NULL for every existing row and cannot be
-- backfilled: the field was never persisted, and the feed only serves a recent
-- stratified window (perTier most-recent-N per machine × tier), not history. So
-- partner attribution begins accruing at the ship date of this migration, and any
-- reader must treat NULL as "unknown origin", never as a partner named 'cc' or as
-- a zero. Expect a long tail of NULL rows for the ~1.43M pulls already stored.
--
-- Nullable + additive: no existing writer or reader changes behaviour.

alter table public.gacha_pulls
  add column if not exists memo_slug text;

-- Partial: only CC rows will ever carry a slug, so the index stays small and a
-- partner rollup ("volume + pulls per partner over 24h/7d/30d") reads it directly
-- instead of scanning the full 1.5M-row table.
create index if not exists gacha_pulls_memo_slug_idx
  on public.gacha_pulls (memo_slug, pulled_at desc)
  where memo_slug is not null;
