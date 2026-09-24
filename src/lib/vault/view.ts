import { PLATFORM_META, type CardPlatform } from "@/lib/card/ids";
import { formatInt } from "@/lib/format";
import type { VaultHolding, VaultValuation } from "@/lib/data/vault";
import type { WalletAddress } from "@/lib/vault/address";

/**
 * THE VAULT'S WORDS — every string the door and the statement print about a
 * wallet, built in one place from the valuation, so the header, the KPI feet,
 * the table's receipt lines and the CSV cannot describe the same result two
 * ways.
 *
 * ⚠️ NOTHING HERE PRICES ANYTHING. Values, totals and their n come from
 * `getVaultValuation` as they are; this file only names them. A floor or an ask
 * is never summed into a value here or anywhere downstream.
 */

export type VaultChain = WalletAddress["chain"];

/** `0x12ab…9f3c` · `7GkP…2mQ4` — the short form everywhere an address is shown. */
export function shortAddress(address: string): string {
  if (address.startsWith("0x")) return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
  return address.length <= 10 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** The chip beside an address: which chains one paste is read on. */
export function chainLabel(chain: VaultChain): string {
  return chain === "solana" ? "Solana" : "Polygon + Base";
}

/**
 * The venues one address is read on — from the card-id registry's chains, not
 * typed here. An EVM address is one address space, so it is read on Polygon
 * (Courtyard) and Base (Beezie) both; a Solana address on every Solana venue.
 */
export function venuesReadFor(chain: VaultChain): { platform: CardPlatform; label: string; chain: string }[] {
  return (Object.entries(PLATFORM_META) as [CardPlatform, { label: string; chain: string }][])
    .filter(([, m]) => (chain === "solana" ? m.chain === "Solana" : m.chain === "Polygon" || m.chain === "Base"))
    .map(([platform, m]) => ({ platform, label: m.label, chain: m.chain }));
}

/**
 * "Collector Crypt, Phygitals" — the empty state's list and the header's
 * receipt. The valuation's own `venues` (what the read actually covered) when
 * it is in hand; the registry's list for the chain otherwise (the door, a read
 * that failed before answering).
 */
export function venuesReadText(chain: VaultChain, venues?: readonly string[] | null): string {
  const list = venues?.length
    ? venues.map((p) => ({ label: PLATFORM_META[p as CardPlatform]?.label ?? p, chain: PLATFORM_META[p as CardPlatform]?.chain ?? "" }))
    : venuesReadFor(chain);
  return list.map((v) => (chain === "evm" && v.chain ? `${v.label} (${v.chain})` : v.label)).join(", ");
}

/**
 * A holding's name as printed. The venue's own spelling when the read carried
 * one; else the venue and a short token id — what the chain actually says about
 * it — rather than a title nobody wrote (a Courtyard mint read off Rarible has
 * no name and no card row yet).
 */
export function holdingName(h: Pick<VaultHolding, "name" | "platform" | "tokenId">): string {
  if (h.name?.trim()) return h.name.trim();
  const t = h.tokenId.length > 12 ? `${h.tokenId.slice(0, 6)}…${h.tokenId.slice(-4)}` : h.tokenId;
  return `${PLATFORM_META[h.platform as CardPlatform]?.label ?? h.platform} token #${t}`;
}

/**
 * Why the door will not take an input — said in words, never a red banner.
 *
 * `parseWalletAddress` is the judge (null = not an address); this only explains
 * the verdict from the input's shape, so the reader can fix it rather than
 * retype it blind. It never accepts what the parser rejected.
 */
export function addressProblem(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/\s/.test(s)) return "an address has no spaces; paste it on its own";
  if (/\.(eth|sol|base)$/i.test(s)) return "names are not resolved yet; paste the address itself";
  if (/^0x/i.test(s)) {
    const body = s.slice(2);
    if (/[^0-9a-f]/i.test(body)) return "an EVM address is 0x and 40 hex characters (0–9, a–f)";
    if (body.length !== 40) return `an EVM address is 0x and 40 hex characters; this has ${body.length}`;
    return "mixed case that fails its checksum, likely a typo; paste it again";
  }
  if (/[0OIl]/.test(s) && /^[0-9A-Za-z]+$/.test(s)) return "0, O, I and l are not in a Solana address";
  if (/[^1-9A-HJ-NP-Za-km-z]/.test(s)) return "a Solana address is base58 letters and digits only";
  return "not 32 bytes: a Solana address is 32 to 44 base58 characters";
}

/** The `partial` receipt line — what stopped the read, and how far it got. */
export function partialText(p: NonNullable<VaultValuation["partial"]>): string {
  const reached = `${formatInt(p.after)} slab${p.after === 1 ? "" : "s"} read`;
  switch (p.reason) {
    case "helius-budget":
      return `partial · stopped at the Solana read budget · ${reached} · totals cover these only`;
    case "rarible-budget":
      return `partial · stopped at the Polygon read budget · ${reached} · totals cover these only`;
    case "blockscout-budget":
      return `partial · stopped at the Base read budget · ${reached} · totals cover these only`;
    case "timeout":
      return `partial · the chain read ran past 20 s · ${reached} · totals cover these only`;
    case "cap":
      return `partial · capped at ${reached} · totals cover these only`;
    case "owner-unverified":
      return `partial · ownership not confirmed on chain · ${reached} from the index · totals cover these only`;
    case "incomplete":
      return `partial · a venue's read did not finish · ${reached} · totals cover these only`;
    default:
      return `partial · ${p.reason.replace(/-/g, " ")} · ${reached} · totals cover these only`;
  }
}

/** A slab the join could not key, in words — each reason said as itself. */
export function unkeyedText(reason: string | undefined): string {
  switch (reason) {
    case "courtyard-no-card-row":
      return "Courtyard mints are not matched to cards yet";
    case "no-name":
      return "the token carries no card name";
    case "grade-as-name":
      return "its name on the venue is a grade, not a card";
    case "no-set-or-number":
      return "no set or card number on the token";
    case "beezie-metadata-cap":
    case "beezie-metadata-timeout":
      return "Beezie metadata not read on this look";
    case "no-identity-parts":
      return "its set, number or grade could not be read";
    case "no-metadata":
      return "the venue returned no metadata for it";
    case undefined:
    case "":
      return "no identity for this slab";
    default:
      return reason.replace(/-/g, " ");
  }
}

/** `3 slabs without a value · no sale yet 2 · no identity 1`. */
export function unvaluedLine(u: VaultValuation["totals"]["unvalued"]): string {
  const parts = [`${formatInt(u.n)} slab${u.n === 1 ? "" : "s"} without a value`];
  const noSale = u.reasons["no-sale"] ?? 0;
  const noId = u.reasons["no-identity"] ?? 0;
  if (noSale) parts.push(`no sale yet ${formatInt(noSale)}`);
  if (noId) parts.push(`no identity ${formatInt(noId)}`);
  for (const [k, n] of Object.entries(u.reasons)) {
    if (k !== "no-sale" && k !== "no-identity" && n) parts.push(`${k.replace(/-/g, " ")} ${formatInt(n)}`);
  }
  return parts.join(" · ");
}

/** "reference" / "last sale" — the value's basis, as the chip says it. */
export function basisLabel(basis: "reference" | "last-sale"): string {
  return basis === "reference" ? "reference" : "last sale";
}

/**
 * THE CSV — every holding, every column, the basis named. What the table shows
 * in chips and receipt lines, the file carries as columns, so a spreadsheet
 * can re-add the total and land on the page's figure.
 */
export function vaultCsv(v: VaultValuation): string {
  const cols = [
    "card_id", "venue", "token_id", "name", "ip", "set", "number", "grade",
    "identity_slug", "unkeyed_reason",
    "reference_usd", "reference_month", "reference_n", "reference_thin",
    "last_sale_usd", "last_sale_date", "last_sale_venue",
    "floor_usd", "floor_venue", "floor_plausible",
    "your_ask_usd", "your_ask_plausible",
    "value_usd", "value_basis", "unvalued_reason",
  ];
  const esc = (x: unknown) => {
    if (x == null) return "";
    const s = String(x);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const row = (h: VaultHolding) => [
    h.cardId, h.platform, h.tokenId, holdingName(h), h.ip, h.set, h.number, h.grade,
    h.identity?.slug, h.identity ? "" : h.unkeyed,
    h.reference?.priceUsd, h.reference?.month, h.reference?.n, h.reference ? (h.reference.thin ? "thin" : "") : "",
    h.lastSale?.priceUsd, h.lastSale?.ts.slice(0, 10), h.lastSale?.venue,
    h.floor?.priceUsd, h.floor?.venue, h.floor ? String(h.floor.plausible) : "",
    h.yourAsk?.priceUsd, h.yourAsk ? String(h.yourAsk.plausible) : "",
    h.value?.usd, h.value?.basis, h.value ? "" : h.unvalued,
  ].map(esc).join(",");
  return [cols.join(","), ...v.holdings.map(row)].join("\n");
}

/** `varible-vault-7GkP…2mQ4.csv` with the ellipsis spelled out for file systems. */
export function vaultCsvName(address: string): string {
  return `varible-vault-${shortAddress(address).replace("…", "-")}.csv`;
}

/**
 * `Collector Crypt 12 · Beezie 4 · Courtyard 3 unkeyed` — the Holdings card's
 * foot, from `byVenue` for the order and the counts, and from the holdings for
 * how many of each venue's slabs the join could not key (a count, not a value).
 */
export function venueSplit(v: VaultValuation): string {
  const unkeyed = new Map<string, number>();
  for (const h of v.holdings) if (!h.identity) unkeyed.set(h.platform, (unkeyed.get(h.platform) ?? 0) + 1);
  return [...v.byVenue]
    .sort((a, b) => b.holdings - a.holdings)
    .map((g) => {
      const u = unkeyed.get(g.key) ?? 0;
      if (!u) return `${g.label} ${formatInt(g.holdings)}`;
      return u === g.holdings ? `${g.label} ${formatInt(g.holdings)} unkeyed` : `${g.label} ${formatInt(g.holdings)} (${formatInt(u)} unkeyed)`;
    })
    .join(" · ");
}

/** How many values rest on each basis — the Value card's `reference n · last sale n`. */
export function basisCounts(v: VaultValuation): { reference: number; lastSale: number } {
  let reference = 0;
  let lastSale = 0;
  for (const h of v.holdings) {
    if (h.value?.basis === "reference") reference++;
    else if (h.value?.basis === "last-sale") lastSale++;
  }
  return { reference, lastSale };
}
