-- Persist the card identity on `cards` so the identity page is a keyset read.
--
-- `identity_key`  = the string the monthly index and the grade premiums chain on
--                   (traits.ts `identityKey`: ip | set | number | NAME | grade |
--                   edition | language).
-- `identity_slug` = the URL form (card/identity.ts `identitySlug`):
--                   <ip>/<set_key>/<number>/<name-slug>/<grade-slug>[/<edition>][/<lang>].
--
-- Both are computed by scripts/backfill-card-identity-key.ts from the SAME
-- extractor the sale panel uses, so the column, the panel and the page agree.
-- NULLABLE on purpose: a token whose parts cannot name an identity (no name, or
-- neither set nor number) has none, and NULL is the honest answer.
--
-- ⚠️ ADDITIVE AND NOT APPLIED BY THE EXECUTOR. The orchestrator applies it
-- together with the pending set_key migration. Until then every reader resolves
-- a slug from the cached sale panel (identityDetail.ts, panel path).
alter table public.cards add column if not exists identity_key text;
alter table public.cards add column if not exists identity_slug text;

-- The identity page looks up by slug; the index / ladder look up by (ip, key).
-- Partial: most rows are set once, and the NULL rows (no identity) stay out.
create index if not exists cards_identity_slug_idx
  on public.cards (identity_slug)
  where identity_slug is not null;
create index if not exists cards_ip_identity_key_idx
  on public.cards (ip_key, identity_key)
  where identity_key is not null;
