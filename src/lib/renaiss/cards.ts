/**
 * Renaiss slabs → `cards` rows, and the grade rule both of its feeds share.
 *
 * Every linked row of the sales feed and every named pull carries the slab
 * (`cert`, `company`, `grade` as the grader prints it) and the catalog card
 * (`name`, `setName`, `setCode`, `cardNumber`, `year`, `language`, `imageUrl`).
 * One `cards` row per token (`rn-<tokenId>`) is written from them, so
 * `readCardDims("renaiss")` joins Renaiss sales to identities in the sale panel,
 * and `readCards` / `readCardMeta` serve `/card/rn-<tokenId>`.
 *
 * ⚠️ ONLY A LINKED ROW WRITES A CARD. `slab` and `catalogCard` are null until the
 * index links the token to its cert (sales) or the platform names the prize
 * (pulls). Upserting from such a row would blank a card another row already
 * named, so it writes nothing and its token stays unkeyed until a linked row
 * arrives.
 *
 * ⚠️ EVERY UPSERT ECHOES `platform`, `token_id`, `chain`, `source` and `name`
 * (PR #128's lesson): PostgREST's upsert is INSERT … ON CONFLICT and Postgres
 * checks the NOT NULL columns before the conflict resolves.
 */
import { parseGrade } from "../card/grade";
import { identitySlug } from "../card/identity";
import { classifyIPFromMeta } from "../data/ipCatalog";
import { cardRowFromMeta, inChunk, upsertCards, type CardRow } from "../data/cards";
import { db } from "../db/client";
import { extractCardIdentity, gradeLabel, identityKey, normalizeTraits, type CardIdentityParts } from "../data/traits";
import type { TokenMetadata } from "../onchain/tokenUri";

export type FeedSlab = { cert: string; company: string | null; grade: string | null };
export type FeedCatalogCard = {
  id: string;
  renaissItemId: string | null;
  name: string;
  setName: string | null;
  setCode: string | null;
  cardNumber: string | null;
  year: number | null;
  language: string | null;
  imageUrl: string | null;
};
export type FeedMoney = { amount: string; currency: string };

/** The grader a cert names by its prefix ("PSA119571435" → "PSA"); null when it has none. */
function certPrefix(cert: string | null | undefined): string | null {
  const m = /^([A-Za-z]+)\d/.exec(cert?.trim() ?? "");
  return m ? m[1].toUpperCase() : null;
}

export type ComposedGrade = {
  /** `cards.grade_label`: "PSA 10". */
  label: string;
  grader: string | null;
  gradeNum: number | null;
  /** "parseGrade" when the SSOT read it; "fallback" when it could not. */
  via: "parseGrade" | "fallback";
};

/**
 * The grade label, `<company> <numeric grade>`, composed through `parseGrade`
 * (card/grade.ts, the SSOT): "PSA" + "10 Gem Mint" → "PSA 10", "PSA" + "GEM MT
 * 10" → "PSA 10", "CGC" + "10 Pristine" → "CGC 10" (Pristine is a CGC grade
 * word, not a grader, and folds to the number as it does on every venue).
 * A null company falls back to the cert's prefix. A pair `parseGrade` cannot
 * read (an unknown grader, no number) gets the label every other venue's
 * traits get from the same pair (`gradeLabel`), and says so in `via`.
 */
export function composeGrade(slab: FeedSlab): ComposedGrade {
  const company = slab.company?.trim() || certPrefix(slab.cert);
  const parsed = parseGrade(`${company ?? ""} ${slab.grade ?? ""}`);
  if (parsed) return { label: parsed.label, grader: parsed.grader, gradeNum: parsed.grade, via: "parseGrade" };
  const t = normalizeTraits({
    attributes: [
      ...(company ? [{ trait_type: "Grader", value: company }] : []),
      ...(slab.grade ? [{ trait_type: "Grade", value: slab.grade }] : []),
    ],
  });
  return { label: gradeLabel(t), grader: t.grader, gradeNum: t.gradeNum, via: "fallback" };
}

/**
 * The catalog image's file name, as words — "cards/one_piece_op06_118_ja_…" →
 * "one piece op06 118 ja …". The catalog names each image after its game, which
 * is the one IP signal a card like "Kecleon · Super Electric Breaker" carries,
 * and the rest of the name is a set code, a number and a hex id, which no IP
 * keyword can match inside. A bare `items/<uuid>/lg.webp` path yields nothing.
 */
function imageNameHint(url: string | null): string | null {
  if (!url) return null;
  try {
    const file = new URL(url).pathname.split("/").pop() ?? "";
    return file.replace(/_/g, " ") || null;
  } catch {
    return null;
  }
}

/** The label/value pairs `/card/rn-<tokenId>` renders, in the trait names `normalizeTraits` reads. */
function attributesOf(slab: FeedSlab, card: FeedCatalogCard, grade: ComposedGrade): NonNullable<TokenMetadata["attributes"]> {
  const pairs: [string, string | number | null | undefined][] = [
    ["Card Name", card.name],
    ["Set Name", card.setName?.trim() || card.setCode?.trim() || null],
    ["Set ID", card.setCode],
    ["Card Number", card.cardNumber],
    ["Year", card.year],
    ["Language", card.language],
    ["Grader", grade.grader ?? slab.company],
    ["Grade", slab.grade],
    ["Cert", slab.cert],
  ];
  return pairs
    .filter((p): p is [string, string | number] => p[1] != null && String(p[1]).trim() !== "")
    .map(([trait_type, value]) => ({ trait_type, value }));
}

/** A `cards` row plus the columns only a feed that names them can fill. */
export type RenaissCardRow = CardRow & {
  grader: string | null;
  grade_num: number | null;
  year: number | null;
  card_number: string | null;
  cert: string | null;
  language: string | null;
  identity_key: string | null;
  identity_slug: string | null;
};

/**
 * One slab → its `cards` row. The shared builder (`cardRowFromMeta`) makes the
 * row from the label/value pairs, then two columns are set from the feed's own
 * fields rather than inferred from text:
 *   • `grade_label` — `composeGrade`, through `parseGrade`;
 *   • `ip_key` — the catalog image's name first, then `classifyIPFromMeta`
 *     (keywords, then the set code: "SV8", "OP06") for an image that names no
 *     game. ⚠️ Not keywords first: they match inside words, and on the Sep 23
 *     sample they read "Sunflora" (Mask of Change, SV6) as football, for the
 *     "nfl" in its name.
 * The identity columns are computed by the same three calls the backfill makes
 * (`extractCardIdentity` → `identityKey` → `identitySlug`), with the Renaiss
 * quirk, so the column and the panel agree from the first write.
 */
export function renaissCardRow(tokenId: string, slab: FeedSlab, card: FeedCatalogCard): RenaissCardRow {
  const grade = composeGrade(slab);
  const attributes = attributesOf(slab, card, grade);
  const meta: TokenMetadata = { name: card.name, image: card.imageUrl ?? undefined, attributes };
  const base = cardRowFromMeta("renaiss", tokenId, meta);

  const hint = imageNameHint(card.imageUrl);
  const viaImage = hint ? classifyIPFromMeta({ name: hint }) : null;
  const ip = viaImage && viaImage.key !== "other" ? viaImage : classifyIPFromMeta(meta);

  const row = {
    ...base,
    ip_key: ip.key,
    grade_label: grade.label,
    grader: grade.grader,
    grade_num: grade.gradeNum,
    year: card.year ?? null,
    card_number: card.cardNumber?.trim() || null,
    cert: slab.cert?.trim() || null,
    language: card.language?.trim() || null,
  };
  const parts = renaissIdentityParts(row, card.setCode);
  const key = identityKey(row.ip_key, parts);
  return { ...row, identity_key: key, identity_slug: key ? identitySlug(row.ip_key, parts) : null };
}

/** The identity parts of a Renaiss row — the extractor's own quirk, fed the feed's set code. */
export function renaissIdentityParts(
  row: Pick<RenaissCardRow, "name" | "card_name" | "set_name" | "grade_label" | "year" | "card_number" | "language">,
  setCode?: string | null,
): CardIdentityParts {
  return extractCardIdentity({
    platform: "renaiss",
    name: row.name,
    cardName: row.card_name,
    set: row.set_name,
    setCode,
    grade: row.grade_label,
    year: row.year,
    cardNumber: row.card_number,
    language: row.language,
  });
}

/** One row per token; a later row for the same token replaces an earlier one. */
export function collectCardRows(linked: { tokenId: string; slab: FeedSlab; card: FeedCatalogCard }[]): RenaissCardRow[] {
  const byId = new Map<string, RenaissCardRow>();
  for (const l of linked) {
    const row = renaissCardRow(l.tokenId, l.slab, l.card);
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

/**
 * The rows whose token has no `cards` row yet. A token's card is written the
 * first time a linked row names it: the pulls feed re-reads 14 days on every
 * run (the Sep 23 sample: 500 pulls, 418 distinct prizes, in three hours), and
 * rewriting every prize's row each time would be tens of thousands of identical
 * upserts a run.
 */
export async function filterUnseenCards(rows: RenaissCardRow[]): Promise<RenaissCardRow[]> {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const CHUNK = inChunk(ids);
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db().from("cards").select("id").in("id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`[cards] renaiss existence read failed: ${error.message}`);
    for (const r of data ?? []) seen.add(String(r.id));
  }
  return rows.filter((r) => !seen.has(r.id));
}

/** Upsert the rows (adaptive chunking lives in `upsertCards`). */
export async function upsertRenaissCards(rows: RenaissCardRow[]): Promise<number> {
  if (!rows.length) return 0;
  await upsertCards(rows);
  return rows.length;
}
