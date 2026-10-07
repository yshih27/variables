-- Renaiss pulls: the machine's name and the prize's image, and an index for
-- the prize lookups (brief-backend-gacha-renaiss, PR A).
--
-- Both fields arrive on every row of GET /v1/gacha/pulls?platform=renaiss
-- (`machineName`, `imageUrl`) and were dropped by the mapper until now. New
-- pulls carry them from the first run after this is applied; history is filled
-- by `warm-renaiss-pulls --refill-columns --apply` (orchestrator dispatch).
--
-- ⚠️ Until this is applied, the pulls warmer writes without the two columns
-- (pulls.ts detects the missing column and retries without them), so applying
-- it late costs nothing but the columns' history.
--
-- The index: warm-holders' Renaiss step reads every named pull once, keyset on
-- `prize_instance_id` (src/lib/renaiss/holders.ts `readPulledTokens`), to find
-- each token's newest stated value. Without it each page sorts the named pulls;
-- measured Oct 7 on the primary-key fallback: 608 pages in 337 s.

alter table public.renaiss_pulls add column if not exists machine_name text;     -- the feed's machineName
alter table public.renaiss_pulls add column if not exists prize_image_url text;  -- the prize's imageUrl

create index if not exists renaiss_pulls_prize_instance_idx
  on public.renaiss_pulls (prize_instance_id)
  where prize_instance_id is not null;
