/**
 * Pack spend by IP: the money paid for packs and machines, credited to the IP
 * each one sells, over the last 30 complete days. Written by
 * scripts/warm-ip-pack-spend.ts to the `ip-pack-spend` snapshot.
 *
 * Only what can be credited honestly is credited:
 *   • Collector Crypt, per machine, from its machine board (player analytics,
 *     the pulls we capture). A machine whose name or key names one IP is credited
 *     to it ("Soccer $100 Pack", pokemon_5000, esnorlax_5000); a mixed machine
 *     (watches, "PSA 10's ONLY", mixed sports, anime, degen) is not.
 *   • Renaiss, per pull, by the prize it paid out: every pull names its card. A
 *     prize whose title names no IP (a trainer card) takes its machine's IP when
 *     at least RENAISS_MACHINE_SHARE of that machine's identified prizes share it.
 *   • Courtyard, Phygitals, Beezie and DYLI are not split: no pull feed
 *     (Courtyard, Beezie), too little of it captured (Phygitals), or not wired
 *     yet (DYLI). Their pack spend shows in the venue totals only.
 * Each venue's total pack spend over the same window comes from the spine
 * (`gacha_volume_usd`), so a page can say how much of it is credited.
 */
import { classifyIP } from "./ipClassify";
import type { MachineBoard } from "./playerAnalytics";
import { readSnapshot, writeSnapshot } from "../db/snapshots";

export const IP_PACK_SPEND_KEY = "ip-pack-spend";
export const PACK_SPEND_WINDOW_DAYS = 30;
/** A Renaiss prize that names no IP takes its machine's IP only above this share. */
export const RENAISS_MACHINE_SHARE = 0.95;

export type VenueSpend = { usd30d: number; usd7d: number };
export type IpPackSpendRow = VenueSpend & { byVenue: Record<string, VenueSpend> };
export type VenuePackCoverage = {
  /** The venue's whole pack spend over the window (spine), or null when unknown. */
  packSpend30dUsd: number | null;
  /** How much of it this snapshot credits to an IP. */
  creditedUsd30d: number;
  /** How the credit is made, or why it is not ("no pull feed"). */
  basis: string;
  /** Last complete day the venue's credited figures cover (ISO date), when credited. */
  asOf: string | null;
};
export type IpPackSpendSnapshot = {
  generatedAt: string;
  windowDays: number;
  byIp: Record<string, IpPackSpendRow>;
  venues: Record<string, VenuePackCoverage>;
};

// ── Collector Crypt: one machine → one IP, or none ──────────────────────────

/** Machines whose prizes are not one IP: watches, PSA-10 days, mixed sports, themes. */
const CC_MIXED = /watch|(^|_)sports?(_|$)|anime|degen|vintage|v90s|fire|spooky|spider|(^|_)e?10(_|$)/;

/**
 * The IP a Collector Crypt machine sells, or null for a mixed or unknown one.
 * Reads the display name first ("Celestial Pokémon Gacha Pack"), then the key
 * with its event prefix stripped ("esnorlax_5000" → "snorlax", "ejup_poke_100"
 * → "poke"). Watches are checked before Pokémon: "epokewatch" pays out watches.
 */
export function ccMachineIp(key: string, name: string | null): string | null {
  const k = key.replace(/^collector-crypt:/, "").toLowerCase();
  const display = name && name !== key ? name : null;
  if (CC_MIXED.test(k) || (display && /\bwatch|sports gacha|all-star sports|psa 10's only|anime/i.test(display))) return null;
  if (display) {
    const byName = classifyIP([display]).key;
    if (byName !== "other") return byName;
  }
  const words = k.split(/[_\d]+/).filter(Boolean);
  if (words.some((w) => /poke/.test(w))) return "pokemon";
  for (const w of words) {
    for (const cand of [w, w.replace(/^(e|bf|ejup|esf)/, "")]) {
      const ip = classifyIP([cand]).key;
      if (ip !== "other") return ip;
    }
  }
  if (words.includes("comic")) return "comics";
  return null;
}

// ── Renaiss: each pull by its prize ──────────────────────────────────────────

export type RenaissPackPull = {
  product_id: string;
  price_usd: number | string | null;
  pulled_at: string;
  prize_card_name: string | null;
  prize_set_name: string | null;
};

/**
 * Each pull's IP: its prize's, or (for a prize that names none) its machine's
 * when the machine's identified prizes are RENAISS_MACHINE_SHARE one IP; else null.
 */
export function renaissPullIps(pulls: RenaissPackPull[]): (string | null)[] {
  const direct = pulls.map((p) => {
    const ip = classifyIP([p.prize_card_name ?? undefined, p.prize_set_name ?? undefined]).key;
    return ip === "other" ? null : ip;
  });
  const byMachine = new Map<string, Map<string, number>>();
  pulls.forEach((p, i) => {
    const ip = direct[i];
    if (!ip) return;
    const m = byMachine.get(p.product_id) ?? new Map<string, number>();
    m.set(ip, (m.get(ip) ?? 0) + 1);
    byMachine.set(p.product_id, m);
  });
  const dominant = new Map<string, string>();
  for (const [machine, counts] of byMachine) {
    const total = [...counts.values()].reduce((s, n) => s + n, 0);
    const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (total > 0 && n / total >= RENAISS_MACHINE_SHARE) dominant.set(machine, top);
  }
  return pulls.map((p, i) => direct[i] ?? dominant.get(p.product_id) ?? null);
}

// ── Assembly ─────────────────────────────────────────────────────────────────

const usd = (v: number | string | null | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function buildIpPackSpend(input: {
  ccBoard: MachineBoard | null;
  renaissPulls: RenaissPackPull[];
  /** Start of the day after the window's last complete day (ms, UTC midnight). */
  windowEndMs: number;
  /** Each venue's whole pack spend over the window (spine), null when unknown. */
  venueTotals: Record<string, number | null>;
  generatedAt?: string;
}): IpPackSpendSnapshot {
  const byIp: Record<string, IpPackSpendRow> = {};
  const add = (ip: string, venue: string, d30: number, d7: number) => {
    const row = (byIp[ip] ??= { usd30d: 0, usd7d: 0, byVenue: {} });
    row.usd30d += d30;
    row.usd7d += d7;
    const v = (row.byVenue[venue] ??= { usd30d: 0, usd7d: 0 });
    v.usd30d += d30;
    v.usd7d += d7;
  };

  let ccCredited = 0;
  for (const m of input.ccBoard?.rows ?? []) {
    const ip = ccMachineIp(m.key, m.name);
    if (!ip) continue;
    add(ip, "collector-crypt", m.spendUsd, m.spend7dUsd);
    ccCredited += m.spendUsd;
  }

  const start30 = input.windowEndMs - PACK_SPEND_WINDOW_DAYS * 86_400_000;
  const start7 = input.windowEndMs - 7 * 86_400_000;
  const inWindow = input.renaissPulls.filter((p) => {
    const t = Date.parse(p.pulled_at);
    return t >= start30 && t < input.windowEndMs && usd(p.price_usd) > 0;
  });
  const ips = renaissPullIps(inWindow);
  let rnCredited = 0;
  inWindow.forEach((p, i) => {
    const ip = ips[i];
    if (!ip) return;
    const v = usd(p.price_usd);
    add(ip, "renaiss", v, Date.parse(p.pulled_at) >= start7 ? v : 0);
    rnCredited += v;
  });

  const total = (k: string) => {
    const v = input.venueTotals[k];
    return v != null && Number.isFinite(v) ? v : null;
  };
  const ccAsOf = input.ccBoard?.asOf ? input.ccBoard.asOf.slice(0, 10) : null;
  const lastDay = isoDay(input.windowEndMs - 86_400_000);
  const venues: Record<string, VenuePackCoverage> = {
    "collector-crypt": { packSpend30dUsd: total("collector-crypt"), creditedUsd30d: ccCredited, basis: "machines that sell one IP, from the pulls we capture", asOf: ccAsOf },
    renaiss: { packSpend30dUsd: total("renaiss"), creditedUsd30d: rnCredited, basis: "each pull by the prize it paid out", asOf: lastDay },
    courtyard: { packSpend30dUsd: total("courtyard"), creditedUsd30d: 0, basis: "no pull feed", asOf: null },
    phygitals: { packSpend30dUsd: total("phygitals"), creditedUsd30d: 0, basis: "too few pulls captured to split", asOf: null },
    beezie: { packSpend30dUsd: total("beezie"), creditedUsd30d: 0, basis: "no pull feed", asOf: null },
    dyli: { packSpend30dUsd: total("dyli"), creditedUsd30d: 0, basis: "not split yet", asOf: null },
  };

  return { generatedAt: input.generatedAt ?? new Date().toISOString(), windowDays: PACK_SPEND_WINDOW_DAYS, byIp, venues };
}

/** Venue keys → display names for the coverage line (kept here: no import of the registry). */
const VENUE_NAMES: Record<string, string> = {
  "collector-crypt": "Collector Crypt",
  courtyard: "Courtyard",
  phygitals: "Phygitals",
  renaiss: "Renaiss",
  beezie: "Beezie",
  dyli: "DYLI",
};

/**
 * The coverage behind every IP's pack spend, from the snapshot: what is credited
 * across venues, out of all venues' pack spend, which venues with pack spend are
 * not split, and the window's last complete day (the latest a credited venue covers).
 */
export function packCoverageOf(s: IpPackSpendSnapshot): { creditedUsd: number; totalUsd: number; notSplit: string[]; asOf: string | null } {
  const venues = Object.entries(s.venues);
  const creditedUsd = venues.reduce((a, [, v]) => a + v.creditedUsd30d, 0);
  const totalUsd = venues.reduce((a, [, v]) => a + (v.packSpend30dUsd ?? 0), 0);
  const notSplit = venues.filter(([, v]) => v.creditedUsd30d === 0 && (v.packSpend30dUsd ?? 0) > 0).map(([k]) => VENUE_NAMES[k] ?? k);
  const days = venues.map(([, v]) => v.asOf).filter((d): d is string => Boolean(d)).sort();
  return { creditedUsd, totalUsd, notSplit, asOf: days.length ? days[days.length - 1] : null };
}

export async function readIpPackSpend(): Promise<IpPackSpendSnapshot | null> {
  return readSnapshot<IpPackSpendSnapshot>(IP_PACK_SPEND_KEY);
}

export async function writeIpPackSpend(s: IpPackSpendSnapshot): Promise<void> {
  await writeSnapshot(IP_PACK_SPEND_KEY, s, s.generatedAt);
}
