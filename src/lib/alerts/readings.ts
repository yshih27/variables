/**
 * The run's READS — every source read ONCE per run, then one reading per
 * watched entity (never per subscription):
 *
 *   identities → the sale panel + the identity index + the listings snapshot,
 *                through `valueIdentityGroups` / `priceFieldsOf` (the identity
 *                page's own floor, reference and last sale; its slabs' asks)
 *   volume     → the spine: platform `volume_usd` + `gacha_volume_usd`, ip
 *                `volume_usd`, judged on SOURCE-COMPLETE days only (INV-8)
 *   clears     → the secondary-sales store (the site's wash-trade hygiene
 *                applied), joined to identity and ip through the card rows
 *
 * Nothing here computes a number the site does not: a reading is the page's
 * figures, gathered.
 */
import { cachedPanel, cachedListingsAsOf, listIdentityIndex, valueIdentityGroups } from "@/lib/data/identityDetail";
import { priceFieldsOf } from "@/lib/data/referencePrice";
import { readMetricSeriesBulk, sourceDayCompleteness, dayStartUtc, type SeriesPoint } from "@/lib/data/metricSnapshots";
import { readSecondarySalesSnapshot } from "@/lib/data/secondarySalesCache";
import { cleanSecondarySales } from "@/lib/data/secondaryHygiene";
import { readCardRowsByIds, type CardPlatform } from "@/lib/data/cards";
import { resolveHolding } from "@/lib/data/vault";
import { cardHref } from "@/lib/card/ids";
import { identityLabelFromKey } from "./entities";
import { VOLUME_BASE_DAYS, type EntityRef, type IdentityReading, type SaleRef, type VolumeReading } from "./signals";

export type Readings = {
  identities: Map<string, IdentityReading>;
  volumes: Map<string, VolumeReading | null>;
  sales: { byIdentity: Map<string, SaleRef[]>; byIp: Map<string, SaleRef[]>; byPlatform: Map<string, SaleRef[]>; storeAsOf: string | null };
  timings: Record<string, number>;
};

/** How far back a run looks for clears. The 6-hourly run's cursors are never
 *  older than a missed day or two; a baseline takes the newest sale it sees. */
export const CLEAR_LOOKBACK_MS = 3 * 86_400_000;

const cardIdOf = (platform: string, tokenId: string) => {
  const href = cardHref(platform, tokenId);
  return href === "#" ? `${platform}:${tokenId}` : href.replace(/^\/card\//, "");
};
const byDay = (series: SeriesPoint[] | undefined) => {
  const m = new Map<string, number>();
  for (const p of series ?? []) {
    const t = Date.parse(p.ts);
    if (Number.isFinite(t) && Number.isFinite(p.value)) m.set(dayStartUtc(t), (m.get(dayStartUtc(t)) ?? 0) + p.value);
  }
  return m;
};

export async function loadReadings(entities: EntityRef[], opts: { now?: number } = {}): Promise<Readings> {
  const now = opts.now ?? Date.now();
  const timings: Record<string, number> = {};
  const time = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      timings[label] = Date.now() - t0;
    }
  };
  const ids = entities.filter((e) => e.type === "identity");
  const vols = entities.filter((e) => e.type !== "identity");

  // ── identities ──
  const identities = new Map<string, IdentityReading>();
  if (ids.length) {
    await time("identities", async () => {
      const [panel, idx, listings] = await Promise.all([cachedPanel(), listIdentityIndex(), cachedListingsAsOf()]);
      const found = ids.map((e) => ({ e, keys: idx.bySlug.get(e.key) ?? [] })).filter((x) => x.keys.length);
      const valued = valueIdentityGroups(found.map((x) => x.keys), { panel, slabsByKey: idx.slabsByKey, listings: listings.index, now });
      const asOf = listings.generatedAt ?? new Date(now).toISOString();
      found.forEach(({ e }, i) => {
        const v = valued[i];
        const f = priceFieldsOf(v);
        identities.set(e.key, {
          entity: e,
          floor: f.floor ? { priceUsd: f.floor.priceUsd, venue: f.floor.venue, plausible: f.floor.plausible } : null,
          reference: f.price ? { priceUsd: f.price.priceUsd, month: f.price.month, n: f.price.n } : null,
          lastSale: f.lastSale ? { priceUsd: f.lastSale.priceUsd, ts: f.lastSale.ts } : null,
          listed: v.slabs
            .filter((s) => s.listing && s.listing.priceUsd > 0)
            .map((s) => ({ cardId: cardIdOf(s.platform, s.tokenId), venue: s.listing!.platform, priceUsd: s.listing!.priceUsd, source: s.listing!.source })),
          listingsAsOf: asOf,
        });
      });
    });
  }

  // ── volume (spine, source-complete days) ──
  const volumes = new Map<string, VolumeReading | null>();
  if (vols.length) {
    await time("spine", async () => {
      const needIp = vols.some((e) => e.type === "ip");
      const [pVol, pGac, iVol] = await Promise.all([
        readMetricSeriesBulk("platform", "volume_usd"),
        readMetricSeriesBulk("platform", "gacha_volume_usd"),
        needIp ? readMetricSeriesBulk("ip", "volume_usd") : Promise.resolve(new Map<string, SeriesPoint[]>()),
      ]);
      // INV-8: a day counts only when every source that wrote the day before
      // wrote it too — the same gate the homepage's deltas pass.
      const bySource = new Map<string, SeriesPoint[]>();
      for (const [k, s] of pVol) bySource.set(`${k}:volume_usd`, s);
      for (const [k, s] of pGac) bySource.set(`${k}:gacha_volume_usd`, s);
      const { days, complete } = sourceDayCompleteness(bySource);
      const completeDays = days.filter((d) => complete.has(d)).map((d) => dayStartUtc(Date.parse(d)));
      const day = completeDays.at(-1) ?? null;
      const base = day ? completeDays.slice(0, -1).slice(-VOLUME_BASE_DAYS) : [];
      for (const e of vols) {
        if (!day) {
          volumes.set(`${e.type}:${e.key}`, null);
          continue;
        }
        const resale = byDay(e.type === "platform" ? pVol.get(e.key) : iVol.get(e.key));
        const packs = e.type === "platform" ? byDay(pGac.get(e.key)) : null;
        const total = (d: string) => (resale.get(d) ?? 0) + (packs?.get(d) ?? 0);
        volumes.set(`${e.type}:${e.key}`, {
          entity: e,
          day,
          totalUsd: total(day),
          resaleUsd: resale.get(day) ?? 0,
          packsUsd: packs ? (packs.get(day) ?? 0) : null,
          meanUsd: base.length ? base.reduce((a, d) => a + total(d), 0) / base.length : 0,
          window: { from: base[0] ?? day, to: base.at(-1) ?? day, days: base.length },
        });
      }
    });
  }

  // ── clears (secondary-sales store) ──
  const sales: Readings["sales"] = { byIdentity: new Map(), byIp: new Map(), byPlatform: new Map(), storeAsOf: null };
  if (entities.length) {
    await time("sales", async () => {
      const snap = await readSecondarySalesSnapshot();
      if (!snap) return;
      sales.storeAsOf = snap.generatedAt;
      const since = new Date(now - CLEAR_LOOKBACK_MS).toISOString();
      const needJoin = entities.some((e) => e.type !== "platform");
      for (const [platform, raw] of Object.entries(snap.platforms ?? {})) {
        const recent = cleanSecondarySales(raw).sales.filter((s) => s.date >= since && s.priceUsd > 0);
        if (!recent.length) continue;
        const rows =
          needJoin && platform !== "courtyard" && platform !== "dyli"
            ? await readCardRowsByIds(platform as CardPlatform, recent.map((s) => s.tokenId)).catch(() => new Map())
            : new Map();
        for (const s of recent) {
          const row = rows.get(s.tokenId) ?? null;
          const h = row ? resolveHolding({ platform: platform as CardPlatform, tokenId: s.tokenId }, { row, meta: null, columnKnown: false }) : null;
          const ref: SaleRef = {
            cardId: cardIdOf(platform, s.tokenId),
            // The identity's label ("Lugia-Holo · PSA 10") when the sale keys to one, else the card's own name.
            name: (h?.identity ? identityLabelFromKey(h.identity.key) : null) ?? h?.name ?? null,
            venue: platform,
            priceUsd: s.priceUsd,
            ts: s.date,
            identitySlug: h?.identity?.slug ?? null,
            ip: h?.ip ?? null,
          };
          const push = (m: Map<string, SaleRef[]>, k: string | null) => {
            if (k) (m.get(k) ?? m.set(k, []).get(k)!).push(ref);
          };
          push(sales.byPlatform, platform);
          push(sales.byIp, ref.ip);
          push(sales.byIdentity, ref.identitySlug);
        }
      }
    });
  }

  return { identities, volumes, sales, timings };
}
