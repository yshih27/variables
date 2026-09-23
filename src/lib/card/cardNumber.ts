/**
 * CARD NUMBERS — the ONE normaliser from a platform's raw card-number string to
 * the token the identity is keyed and slugged on.
 *
 * ⚠️ THE RAW FIELD IS DIRTY THE SAME WAY `set_name` IS. One printed number
 * arrives as "#6", "6", "006", "006/165" and "6/165" depending on whether the
 * venue copied the PSA label, the card face or the set checklist. Keyed raw (the
 * v4.1 rule), that is up to five identities for one card: each one thin, none of
 * them clearing MIN_SALES_PER_IDENTITY, and the card's price absent from the
 * page and from the index's overlap.
 *
 * WHAT THIS DOES, IN ORDER: upper-case and drop whitespace and `#`; drop a
 * `/total` denominator ("025/102" → "025" — the SET already carries the print
 * run, so the denominator is redundant and only ever varies); drop the leading
 * zeros of the leading digit run ("006" → "6", "SV049" → "SV49").
 *
 * ⚠️ THE ZERO RULE ONLY FIRES ON A PLAIN `<letters><digits><letters>` TOKEN.
 * One Piece prints compound codes — "ST01-007", "OP13-001" — where the leading
 * "01" is a SET code, not a card number with padding. Stripping inside those
 * would rewrite a printed code ("ST01-007" → "ST1-007") for no gain: nothing in
 * the feeds writes the short form, so there is nothing to merge with. A token
 * carrying a separator is therefore left alone apart from case and `#`.
 *
 * ⚠️ IDEMPOTENT. `normalizeCardNumber(normalizeCardNumber(x)) === normalizeCardNumber(x)`
 * for every input, which is what lets it run at both ends of the pipe — on the
 * extractor's raw token, and again on a token read back out of an identity key
 * or a URL — without a second scheme appearing anywhere.
 */

/** A denominator is a set total: "102", "TG30", "SV122", "H32". */
const DENOMINATOR = /^[A-Z]*\d+[A-Z]*$/;

/** letters? + digits + letters?, the only shape the zero rule touches. */
const PADDED = /^([A-Z]*)0+(\d+[A-Z]*)$/;

/**
 * Raw card number → the canonical token, or null when nothing is left.
 * Total: an unrecognised shape keeps its own (upper-cased) form rather than
 * becoming null, so no identity is ever lost to this function.
 */
export function normalizeCardNumber(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/#/g, "")
    .replace(/^\/+|\/+$/g, "");
  if (!s) return null;

  // "025/102" → "025". Only a two-part token whose tail is a plain total: a
  // number that happens to hold two slashes is not a fraction we understand,
  // and guessing at it would merge cards we cannot prove are the same.
  const parts = s.split("/");
  if (parts.length === 2 && parts[0] && DENOMINATOR.test(parts[1])) s = parts[0];

  s = s.replace(PADDED, "$1$2");
  return s || null;
}
