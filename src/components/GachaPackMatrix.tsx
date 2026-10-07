"use client";

/**
 * The Gacha MATRIX + COMPARE (design handoff "Varible — Gacha Matrix").
 *
 * Screen 1 — Matrix: platforms × price tiers for one IP at a glance. Each cell
 * is the platform's pack at that price (best-odds pack when several share the
 * cell — flagged "+N", the drawer steps through them). Best odds per tier
 * column is highlighted. Replaces the old list-form GachaPackExplorer.
 * Screen 2 — Detail drawer (click a cell): one pack analyzed in depth.
 * Screen 3 — Compare: pin packs (cells/drawer) → bottom tray → full-screen
 * side-by-side with magnitude bars, per-row leader, column reorder, add-picker
 * and an Absolute-$ / per-$1 normalization toggle for cross-price fairness.
 *
 * Honesty adaptations vs the prototype (which used synthetic data):
 *   • every number keeps its BASIS dot (stated | measured(n) | assumed) and
 *     thin-sample (n<THIN_N) greying — the prototype had one homogeneous feed;
 *   • "Hits left / unclaimed" is omitted (no real claimed-state source);
 *   • Top hit (pool ceiling) and Biggest pulled (realized) stay separate rows —
 *     CC has no published pool, so its pool ceiling is "—", never faked;
 *   • odds-breakdown rows use the canonical measured value bands (PH + CC);
 *     Beezie has no per-pull feed → "—" (its stated tiers live in the drawer).
 * Pins persist to localStorage (cap 5, FIFO) keyed by durable pack ids.
 */

import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Section } from "./Section";
import { formatCompactUsd, formatInt } from "@/lib/format";
import { proxyImg } from "@/lib/img";
import { cardHref, cardSupported } from "@/lib/card/ids";
import type { GachaPack, GachaPrize, MetricBasis } from "@/lib/data/gachaPacksCache";
import {
  leadEv,
  leadHitOdds,
  leadMedian,
  netEv,
  chaseUsd,
  isThin,
  oddsAudit,
  AUDIT_MIN_N,
  type Lead,
} from "@/lib/data/gachaPackView";
import { KIND_WORD, coverageLine, type GachaVenue, type VenueKind } from "@/lib/gacha/venueView";

/* ───────────────────────── meta ───────────────────────── */

/**
 * ⚠️ VENUES COME FROM DATA. Rows, their order, names, monograms and kinds are the
 * `venues` list the page derives from the payload (src/lib/gacha/venueView.ts) —
 * never a hard-coded three. The matrix provides it; every nested component (the
 * finder, the drawer, the prize modal, the compare overlay) reads the same list.
 */
type VenueIndex = {
  coveredKeys: string[];
  byKey: (key: string) => GachaVenue | undefined;
  order: (key: string) => number;
  name: (key: string) => string;
  /** "Claw" / "Machine" / "Pack" / "Box" — the venue's own word, or null when the payload does not say. */
  kind: (key: string) => VenueKind | null;
};
function indexOf(venues: GachaVenue[]): VenueIndex {
  const byKey = (key: string) => venues.find((v) => v.key === key);
  return {
    coveredKeys: venues.filter((v) => v.covered).map((v) => v.key),
    byKey,
    order: (key) => {
      const i = venues.findIndex((v) => v.key === key);
      return i < 0 ? venues.length : i;
    },
    name: (key) => byKey(key)?.name ?? key,
    kind: (key) => byKey(key)?.kind ?? null,
  };
}
const VenuesCtx = createContext<VenueIndex>(indexOf([]));
const useVenues = () => useContext(VenuesCtx);
type Tab = { key: string; label: string };
/** The games with a tab of their own, first and in this order. Any other game
 *  follows under its own label; "Mixed" (no single game) comes last. */
const LEAD_TABS: Tab[] = [
  { key: "pokemon", label: "Pokémon" },
  { key: "one_piece", label: "One Piece" },
  { key: "sports", label: "Sports" },
];
/** Mixed pools (`mixedPool`): in every game tab; LISTED once, under this. */
const MIXED: Tab = { key: "mixed", label: "Mixed" };
/** A single-game product whose game the payload does not name (CC's DRGNBLL,
 *  DYLI's Watch Box, an unattributed Phygitals slug): one tab, never "Mixed". */
const OTHER: Tab = { key: "other", label: "Other" };
/** A pack's (or prize's) own tab: its game, or "other" when it names none. */
function tabOf(p: { category: string | null }): string {
  return p.category ?? OTHER.key;
}
/**
 * Whether a pack sits in EVERY game tab. Only a pool the payload flags as
 * spanning games (`mixedPool`, Beezie's claws) does: a single-game pack whose
 * game has no lead tab (CC's DRGNBLL, DYLI's Watch Box) gets a tab of its own
 * instead of being repeated under Pokémon as if it paid Pokémon cards.
 */
function inEveryTab(p: GachaPack): boolean {
  return p.mixedPool === true;
}
/** The tab list for a set of (game key, the payload's label for it). */
function tabsFor(entries: { key: string; label?: string | null }[]): Tab[] {
  const labels = new Map<string, string>();
  for (const e of entries) if (!labels.has(e.key) || !labels.get(e.key)) labels.set(e.key, e.label ?? "");
  const lead = LEAD_TABS.filter((t) => labels.has(t.key));
  const own = [...labels.entries()]
    .filter(([k]) => k !== MIXED.key && k !== OTHER.key && !LEAD_TABS.some((t) => t.key === k))
    .map(([key, label]) => ({ key, label: label && label !== "—" && label !== "Mixed" ? label : titleOf(key) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...lead, ...own, ...(labels.has(OTHER.key) ? [OTHER] : []), ...(labels.has(MIXED.key) ? [MIXED] : [])];
}
/** "dragon_ball" → "Dragon Ball", for a game the payload gives no label. */
function titleOf(key: string): string {
  return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
/** One price column's pitch in the matrix: a 140px cell + the 7px gap. */
const COL_PX = 147;
/** How much of the column before the opening band shows under the left fade:
 *  enough to say "more this way", so the band itself starts clear of the fade. */
const PEEK_PX = 24;

/**
 * The price band the matrix opens on: of every run of `fit` adjacent price
 * columns (what the frame shows at once), the one where the most venues have a
 * product; ties go to the run with more filled cells, then the cheaper one.
 * Returns the index of the run's first column. Pure, so it can be checked
 * without a browser.
 */
export function densestBand(
  prices: number[],
  rows: { cells: Map<number, unknown[]> }[],
  fit: number,
): number {
  const k = Math.max(1, Math.min(fit, prices.length));
  let best = 0;
  let bestVenues = -1;
  let bestCells = -1;
  for (let i = 0; i + k <= prices.length; i++) {
    const band = prices.slice(i, i + k);
    let venues = 0;
    let cells = 0;
    for (const r of rows) {
      const n = band.filter((pr) => (r.cells.get(pr)?.length ?? 0) > 0).length;
      if (n > 0) venues += 1;
      cells += n;
    }
    if (venues > bestVenues || (venues === bestVenues && cells > bestCells)) {
      best = i;
      bestVenues = venues;
      bestCells = cells;
    }
  }
  return best;
}

/** Where a pack is LISTED once (mobile list, compare picker): a mixed pool under "Mixed". */
function listTabOf(p: GachaPack): string {
  return inEveryTab(p) ? MIXED.key : tabOf(p);
}
function tierLabel(price: number): string {
  return price >= 1000 ? `$${(price / 1000).toString().replace(/\.0$/, "")}K` : `$${price}`;
}

const MAX_COMPARE = 5;
const PINS_LS_KEY = "gacha:compare:v1";

function pct(n: number | null, dp = 1): string {
  if (n == null) return "—";
  if (n <= 0) return "0%";
  if (n >= 1) return "100%";
  const v = n * 100;
  if (v < 0.1) return "<0.1%";
  if (v > 99) return ">99%"; // short of certainty must never round to 100%
  return `${parseFloat(v.toFixed(v < 10 ? dp : 0))}%`;
}
function basisColor(b: MetricBasis): string {
  return b === "realized" ? "var(--color-green)" : b === "stated" ? "var(--color-ink-3)" : "var(--color-ink-4)";
}
function basisTitle(b: MetricBasis, n?: number | null): string {
  if (b === "realized") return `Measured on-chain${n != null ? ` · ${n} pull${n === 1 ? "" : "s"}` : ""}`;
  if (b === "stated") return "Platform-advertised — vendor claim, unverified";
  if (b === "assumed") return "Unverified estimate, no source";
  return "Platform-wide only — not specific to this product";
}
/** The venue's own word for one product, lower-case; "product" when the payload does not say. */
function kindNoun(k: VenueKind | null): string {
  return k ? KIND_WORD[k].one.toLowerCase() : "product";
}
function Dot({ basis, n }: { basis: MetricBasis; n?: number | null }) {
  return (
    <span
      title={basisTitle(basis, n)}
      className="inline-block h-[5px] w-[5px] shrink-0 rounded-none"
      style={{
        background: basis === "assumed" ? "transparent" : basisColor(basis),
        border: basis === "assumed" ? "1px dashed var(--color-ink-4)" : undefined,
      }}
    />
  );
}
/** The venue's two-character registry monogram on a neutral tile — the rail's
 *  own vocabulary, never a one-letter badge or a per-venue colour. */
function Avatar({ platform, short, size }: { platform: string; short: string; size: number }) {
  const code = useVenues().byKey(platform)?.code ?? short;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-none border border-line-2 bg-bg-3 font-mono font-bold text-ink-2"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {code}
    </span>
  );
}

const SLAB_GRADIENT = "linear-gradient(135deg,#2a2150,#123b3b 38%,#3a2740 70%,#15303f)";

/** Card art that degrades to a clean gradient when the source is missing OR
 *  fails to load — some Phygitals irys assets are dead (the gateway 302s to a
 *  cert-broken CDN), so we never show the browser's broken-image icon. Fills
 *  the parent's relative box; `imgClass` carries the per-context fit/zoom. */
function CardArt({ src, imgClass }: { src: string | undefined; imgClass: string }) {
  const [err, setErr] = useState(false);
  if (!src || err) return <span className="absolute inset-0" style={{ background: SLAB_GRADIENT }} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external prize art, codebase convention
    <img src={src} alt="" loading="lazy" onError={() => setErr(true)} className={imgClass} />
  );
}

/** The value-back multiple a pack is judged by (typical when measured, else
 *  vendor EV) — drives the cell bar. Gross of buyback (buyback is its own metric). */
function valueBack(p: GachaPack): Lead | null {
  return leadMedian(p) ?? leadEv(p);
}

/* ───────────────────────── component ───────────────────────── */

/** Where the finder's prizes come from: the payload's on-demand route and counts. */
export type PrizeSource = { route: string; byVenue: Record<string, number>; total: number };

export function GachaPackMatrix({ packs, prizes, venues }: { packs: GachaPack[]; prizes: PrizeSource; venues: GachaVenue[] }) {
  const vi = useMemo(() => indexOf(venues), [venues]);
  // CC Dune-fallback shells aren't pack-attributable — the matrix is pack-grain.
  const usable = useMemo(() => packs.filter((p) => !p.notDirectlyComparable && p.priceUsd > 0), [packs]);
  const byId = useMemo(() => new Map(usable.map((p) => [p.id, p])), [usable]);

  // A mixed pool is in every tab already, so it adds no tab of its own; when
  // every pack is one, "Mixed" is the one tab they share.
  const tabs = useMemo(() => {
    const own = tabsFor(usable.filter((p) => !inEveryTab(p)).map((p) => ({ key: tabOf(p), label: p.categoryLabel })));
    return own.length || usable.length === 0 ? own : [MIXED];
  }, [usable]);
  const [tabPick, setTab] = useState<string>("pokemon");
  const tab = tabs.some((t) => t.key === tabPick) ? tabPick : (tabs[0]?.key ?? tabPick);
  const [pins, setPins] = useState<string[]>([]);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [cmpOpen, setCmpOpen] = useState(false);
  const [norm, setNorm] = useState<"abs" | "dollar">("abs");
  const hydrated = useRef(false);

  // pins persist across reloads (durable pack ids). Hydrated in a deferred
  // callback — localStorage isn't available during SSR render.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(PINS_LS_KEY);
        if (raw) {
          const ids = (JSON.parse(raw) as string[]).filter((id) => byId.has(id));
          if (ids.length) setPins(ids.slice(-MAX_COMPARE));
        }
      } catch {
        // ignore — pins just start empty
      }
      hydrated.current = true;
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(PINS_LS_KEY, JSON.stringify(pins));
    } catch {
      // storage full/blocked — pins still work for the session
    }
  }, [pins]);

  // #pack=<id> — a link into one pack's drawer (the page's headline figures use it).
  useEffect(() => {
    const open = () => {
      const m = /(?:^|[#&])pack=([^&]+)/.exec(window.location.hash);
      const id = m ? decodeURIComponent(m[1]) : null;
      if (id && byId.has(id)) {
        const p = byId.get(id)!;
        if (!inEveryTab(p)) setTab(tabOf(p));
        setDrawerId(id);
      }
    };
    const t = setTimeout(open, 0);
    window.addEventListener("hashchange", open);
    return () => {
      clearTimeout(t);
      window.removeEventListener("hashchange", open);
    };
  }, [byId]);

  const togglePin = useCallback((id: string) => {
    setPins((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      const next = [...cur, id];
      return next.length > MAX_COMPARE ? next.slice(next.length - MAX_COMPARE) : next; // FIFO
    });
  }, []);

  // matrix model for the current tab: platform rows × price columns, cells
  // hold ALL packs at that (platform, price) — lead pack shown, rest stepped.
  // Mixed-pool packs (the payload's `mixedPool`, e.g. Beezie's TCG claws) appear
  // in EVERY tab — they're a real alternative at that price — flagged "mixed
  // pool" since their pool (and thus odds) isn't specific to the tab's game.
  const model = useMemo(() => {
    // "Other" is not a game, so a mixed pool (which pays several games) is not in it.
    const inTab = usable.filter((p) => (inEveryTab(p) && tab !== OTHER.key) || listTabOf(p) === tab);
    const prices = [...new Set(inTab.map((p) => p.priceUsd))].sort((a, b) => a - b);
    const platforms = venues.map((v) => v.key).filter((key) => inTab.some((p) => p.platform === key)).map((key) => {
      const mine = inTab.filter((p) => p.platform === key);
      const cells = new Map<number, GachaPack[]>();
      for (const p of mine) {
        const arr = cells.get(p.priceUsd);
        if (arr) arr.push(p);
        else cells.set(p.priceUsd, [p]);
      }
      for (const arr of cells.values())
        arr.sort((a, b) => (leadHitOdds(b)?.value ?? -1) - (leadHitOdds(a)?.value ?? -1));
      const sample = mine[0];
      const mixedPool = tab !== MIXED.key && mine.every(inEveryTab);
      const v = vi.byKey(key);
      return { key, name: v?.name ?? sample.platformName, short: sample.platformShort, chain: v?.chain || sample.chain, kind: v?.kind ?? null, cells, mixedPool };
    });
    // best displayed odds per price column (the lead pack of each cell competes)
    const best = new Map<number, number>();
    for (const price of prices) {
      let mx = -1;
      for (const pl of platforms) {
        const lead = pl.cells.get(price)?.[0];
        const o = lead ? leadHitOdds(lead)?.value ?? -1 : -1;
        if (o > mx) mx = o;
      }
      best.set(price, mx);
    }
    return { prices, platforms, best, inTab };
  }, [usable, tab, venues, vi]);

  // ── The price frame: opens on the densest band, every column reachable ──
  // The scrollbar is hidden (the fades carry the overflow), so ‹ › and the
  // readout between them are how a mouse without a trackpad reaches the rest.
  const gridRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ first: number; last: number; left: boolean; right: boolean }>({
    first: 0,
    last: 0,
    left: false,
    right: false,
  });
  const readView = useCallback(() => {
    const el = gridRef.current;
    if (!el) return;
    const n = model.prices.length;
    const first = Math.min(n - 1, Math.max(0, Math.round(el.scrollLeft / COL_PX)));
    const last = Math.min(n - 1, Math.max(first, Math.floor((el.scrollLeft + el.clientWidth - 140) / COL_PX)));
    setView({ first, last, left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, [model.prices.length]);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const fit = Math.max(1, Math.floor((el.clientWidth - PEEK_PX + 7) / COL_PX));
    const start = densestBand(model.prices, model.platforms, fit);
    el.scrollLeft = start > 0 ? start * COL_PX - PEEK_PX : 0;
    readView();
  }, [model, readView]);
  const stepBand = (dir: 1 | -1) => {
    const el = gridRef.current;
    if (!el) return;
    const fit = Math.max(1, Math.floor((el.clientWidth + 7) / COL_PX));
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * Math.max(1, fit - 1) * COL_PX, behavior: reduce ? "auto" : "smooth" });
  };

  // drawer stepping order: every pack at the SAME price in the open pack's own
  // game (+ mixed pools) — independent of the matrix tab, so packs opened from
  // the prize grid still step sensibly.
  const drawerPack = drawerId ? byId.get(drawerId) ?? null : null;
  const siblings = useMemo(() => {
    if (!drawerPack) return [];
    const dTab = inEveryTab(drawerPack) ? null : tabOf(drawerPack);
    return usable
      .filter(
        (p) =>
          p.priceUsd === drawerPack.priceUsd &&
          (dTab == null || listTabOf(p) === dTab || (inEveryTab(p) && dTab !== OTHER.key)),
      )
      .sort(
        (a, b) =>
          vi.order(a.platform) - vi.order(b.platform) ||
          (leadHitOdds(b)?.value ?? -1) - (leadHitOdds(a)?.value ?? -1),
      )
      .map((p) => p.id);
  }, [usable, drawerPack, vi]);

  // keyboard: Esc closes (compare first, then drawer); ←/→ step the drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (cmpOpen) setCmpOpen(false);
        else setDrawerId(null);
        return;
      }
      if (!drawerId || cmpOpen) return;
      const i = siblings.indexOf(drawerId);
      if (e.key === "ArrowRight" && i >= 0 && i < siblings.length - 1) setDrawerId(siblings[i + 1]);
      if (e.key === "ArrowLeft" && i > 0) setDrawerId(siblings[i - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cmpOpen, drawerId, siblings]);

  const pinned = pins.map((id) => byId.get(id)).filter(Boolean) as GachaPack[];

  // Mobile (below md): one-hand list, grouped by game then price; each row is a
  // pack and opens the drawer (a bottom sheet at that width).
  // One row per pack: a mixed pool is listed once, under "Mixed".
  const mobileGroups = useMemo(
    () =>
      tabsFor(usable.map((p) => ({ key: listTabOf(p), label: p.categoryLabel }))).map((t) => ({
        tab: t,
        rows: usable
          .filter((p) => listTabOf(p) === t.key)
          .sort((a, b) => a.priceUsd - b.priceUsd || vi.order(a.platform) - vi.order(b.platform)),
      })),
    [usable, vi],
  );
  const coverage = coverageLine(venues);

  return (
    <VenuesCtx.Provider value={vi}>
    <section className="mt-6 scroll-mt-24" id="matrix">
      {/* One shared Section frame (D1). The game tabs live INSIDE the frame, above
          the grid — in the header's right slot they pushed past the viewport. */}
      <Section
        title="Every venue, by price"
        readMe="hit odds, top prizes and returns at each price, side by side"
        subtitle="Each cell is one venue's pack, machine, claw or box at that price"
      >
      <div className="mb-3 hidden flex-wrap items-center gap-x-4 gap-y-2 md:flex">
      <div role="tablist" aria-label="Game" className="flex flex-wrap gap-1" data-game-tabs>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            data-tab={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-xl px-[15px] py-2 text-[13px] transition-colors ${
              tab === t.key ? "bg-yellow font-bold text-black" : "border border-line bg-bg-2 font-medium text-ink-3 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {model.prices.length > 1 ? (
        <div className="ml-auto flex items-center gap-2 font-mono text-[11.5px] text-ink-3" data-price-band>
          <BandButton dir={-1} disabled={!view.left} onClick={() => stepBand(-1)} />
          <span className="tabular whitespace-nowrap" aria-live="polite" data-price-band-range>
            {tierLabel(model.prices[view.first] ?? model.prices[0])}–{tierLabel(model.prices[view.last] ?? model.prices[0])}
            <span className="text-ink-4"> · {view.last - view.first + 1} of {model.prices.length} prices</span>
          </span>
          <BandButton dir={1} disabled={!view.right} onClick={() => stepBand(1)} />
        </div>
      ) : null}
      </div>
      {/* matrix — pinned platform rail + scrollable tier grid. Uniform fixed
          row heights keep the two panes aligned; the scrollbar is hidden and a
          right-edge fade signals the overflow instead. The rail + fade masks
          match the Section card surface (bg-1). */}
      <div className="hidden pt-1 md:flex" data-matrix>
        <div className="z-[1] shrink-0 bg-bg-1 pr-4">
          <div className="flex h-[34px] items-end pb-2">
            <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-4">Venue</span>
          </div>
          {model.platforms.map((pl) => (
            <div key={pl.key} className="mt-[7px] flex h-[92px] items-center gap-[11px]">
              <Avatar platform={pl.key} short={pl.short} size={32} />
              <div>
                <div className="whitespace-nowrap text-[14px] font-bold">{pl.name}</div>
                <div className="mt-[3px] flex items-center gap-1.5 whitespace-nowrap text-[10px] text-ink-3">
                  {pl.kind ? <span className="text-ink-2" data-venue-kind={pl.key}>{KIND_WORD[pl.kind].one}</span> : null}
                  {pl.kind ? <span aria-hidden>·</span> : null}
                  {pl.chain}
                  {pl.mixedPool && (
                    <span
                      className="rounded-md border border-line-2 px-1 py-px text-[8.5px] uppercase tracking-[0.06em] text-ink-4"
                      title="No single game — the pool mixes IPs, so odds aren't specific to this tab's game"
                    >
                      mixed pool
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            ref={gridRef}
            onScroll={readView}
            className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            data-matrix-grid
          >
            <div className="w-max pr-6">
              <div className="flex h-[34px] gap-[7px] pb-2">
                {model.prices.map((price) => (
                  <div key={price} className="flex w-[140px] items-end justify-center text-[15px] font-bold tabular">
                    {tierLabel(price)}
                  </div>
                ))}
              </div>
              {model.platforms.map((pl) => (
                <div key={pl.key} className="mt-[7px] flex gap-[7px]">
                  {model.prices.map((price) => {
                    const cellPacks = pl.cells.get(price);
                    if (!cellPacks?.length)
                      return (
                        <div
                          key={price}
                          className="grid h-[92px] w-[140px] shrink-0 place-items-center rounded-xl border border-dashed border-line text-[15px] text-ink-4"
                        >
                          ·
                        </div>
                      );
                    const lead = cellPacks[0];
                    const leadOdds = leadHitOdds(lead)?.value;
                    const colBest = model.best.get(price);
                    // 2+ live packs at the same price → stack them so both are
                    // visible and individually openable (not a hidden "+N").
                    if (cellPacks.length > 1) {
                      return (
                        <MatrixCellMulti
                          key={price}
                          packs={cellPacks}
                          colBest={colBest}
                          onOpen={(id) => setDrawerId(id)}
                        />
                      );
                    }
                    return (
                      <MatrixCell
                        key={price}
                        pack={lead}
                        extra={0}
                        best={leadOdds != null && leadOdds === colBest}
                        pinned={pins.includes(lead.id)}
                        kind={pl.kind}
                        onOpen={() => setDrawerId(lead.id)}
                        onPin={() => togglePin(lead.id)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          {view.left ? (
            <div className="pointer-events-none absolute left-0 top-0 h-full w-10 bg-gradient-to-r from-bg-1 to-transparent" />
          ) : null}
          {view.right ? (
            <div className="pointer-events-none absolute right-0 top-0 h-full w-10 bg-gradient-to-l from-bg-1 to-transparent" />
          ) : null}
        </div>
      </div>

      {/* Mobile: the same packs as a list, grouped by game then price. */}
      <div className="md:hidden" data-matrix-list>
        {mobileGroups.map((g) => (
          <div key={g.tab.key} className="mb-4 last:mb-0">
            <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{g.tab.label}</h3>
            <ul className="divide-y divide-line/60 border border-line">
              {g.rows.map((p) => {
                const o = leadHitOdds(p);
                const thinO = isThin(o);
                const ceiling = chaseUsd(p);
                const k = vi.kind(p.platform);
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => setDrawerId(p.id)} data-list-pack={p.id} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-bg-2">
                      <Avatar platform={p.platform} short={p.platformShort} size={26} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink">{p.name}</span>
                        <span className="block truncate text-[11px] text-ink-3">
                          {vi.name(p.platform)}
                          {k ? ` · ${KIND_WORD[k].one}` : ""} · <span className="tabular">{tierLabel(p.priceUsd)}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-right font-mono">
                        <span className={`block text-[15px] font-bold tabular ${thinO ? "text-ink-3" : "text-ink"}`}>{o ? pct(o.value, 0) : "—"}</span>
                        <span className="block text-[10px] text-ink-4">top {ceiling != null ? formatCompactUsd(ceiling) : "—"}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* The basis of every figure, said once; and who is not here, and why. */}
      <div className="mt-3 flex flex-col gap-1 border-t border-line pt-2.5 font-mono text-[10.5px] leading-snug text-ink-4" data-matrix-receipts>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5"><Dot basis="realized" /> measured on-chain, with its sample size</span>
          <span className="inline-flex items-center gap-1.5"><Dot basis="stated" /> the venue&apos;s own claim, unverified</span>
          <span className="inline-flex items-center gap-1.5"><Dot basis="assumed" /> unverified estimate</span>
          <span>grey = a sample under the floor · — = not published or withheld (hover for why)</span>
        </p>
        {coverage ? <p data-coverage-line>not compared: {coverage}</p> : null}
        {tabs.some((t) => t.key === OTHER.key) ? (
          <p data-other-line>Other: no game on record for these products, so they sit in no game&apos;s tab</p>
        ) : null}
      </div>
      </Section>

      <PrizeFinderLoader source={prizes} packsById={byId} onOpenPack={(id) => setDrawerId(id)} />

      {/* tray */}
      <div
        className={`fixed bottom-[78px] left-1/2 z-[45] lg:bottom-[22px] flex max-w-[94vw] items-center gap-3.5 rounded-2xl border border-line-2 bg-bg-2 py-3 pl-[18px] pr-3.5 shadow-[0_18px_50px_rgba(0,0,0,.55)] transition-transform duration-300 ease-[cubic-bezier(.22,1,.36,1)] ${
          pins.length > 0 ? "-translate-x-1/2" : "-translate-x-1/2 translate-y-[150%]"
        }`}
      >
        <span className="shrink-0 text-[10.5px] uppercase tracking-[0.12em] text-ink-3">Compare</span>
        <div className="flex flex-wrap gap-2">
          {pinned.map((p) => (
            <span
              key={p.id}
              className="flex items-center gap-2 whitespace-nowrap rounded-xl border border-line bg-bg-1 px-[9px] py-1.5 text-[12px]"
            >
              <Avatar platform={p.platform} short={p.platformShort} size={20} />
              <span>
                {p.name} · {tierLabel(p.priceUsd)}
              </span>
              <button type="button" onClick={() => togglePin(p.id)} className="text-[11px] text-ink-4 hover:text-red">
                ✕
              </button>
            </span>
          ))}
        </div>
        <button
          type="button"
          disabled={pins.length < 2}
          onClick={() => setCmpOpen(true)}
          data-compare-open
          className={`h-[38px] shrink-0 rounded-xl px-4 text-[12.5px] font-bold ${
            pins.length >= 2 ? "bg-yellow text-black" : "cursor-default bg-bg-3 text-ink-4"
          }`}
        >
          {pins.length >= 2 ? `Compare ${pins.length} →` : "Pick 2+"}
        </button>
        <button type="button" onClick={() => setPins([])} className="shrink-0 text-[12px] text-ink-3 hover:text-ink">
          Clear
        </button>
      </div>

      {/* drawer */}
      <PackDrawer
        pack={drawerPack}
        siblings={siblings}
        pinned={drawerPack ? pins.includes(drawerPack.id) : false}
        onStep={(id) => setDrawerId(id)}
        onPin={() => drawerPack && togglePin(drawerPack.id)}
        onClose={() => setDrawerId(null)}
      />

      {/* compare overlay */}
      {cmpOpen && pinned.length >= 2 && (
        <CompareOverlay
          packs={pinned}
          all={usable}
          norm={norm}
          onNorm={setNorm}
          onReorder={(i, j) =>
            setPins((cur) => {
              const next = [...cur];
              [next[i], next[j]] = [next[j], next[i]];
              return next;
            })
          }
          onRemove={(id) => {
            setPins((cur) => {
              const next = cur.filter((x) => x !== id);
              if (next.length < 2) setCmpOpen(false);
              return next;
            });
          }}
          onAdd={(id) => togglePin(id)}
          onClose={() => setCmpOpen(false)}
        />
      )}
    </section>
    </VenuesCtx.Provider>
  );
}

/* ───────────────────────── prize finder ───────────────────────── */

const PRIZE_PAGE = 24;
type PrizeSort = "value" | "cheapest" | "name";

/**
 * "Find your chase" — the card-first inverse of the matrix: search every prize
 * the platforms ADVERTISE as currently in a pool, and follow it to the pack
 * that holds it (click → that pack's drawer). Strictly stated-basis; CC
 * publishes no pool, so its absence is said out loud instead of implied away.
 * No per-item odds exist anywhere — only the pack pointer — so none are shown.
 */
type PrizeLoad = "idle" | "loading" | "ready" | "error";

/**
 * The finder's prizes are NOT in the page (they were most of its weight): they
 * load from the payload's `prizesRoute` once the finder comes within 300px of
 * the viewport, so a reader who never scrolls that far never pays for them.
 * Until then the finder is sized from `prizesByVenue` (its venue menu and its
 * count are real before a byte of prizes arrives), and its grid is a fixed-
 * height placeholder, so nothing below it jumps when they land.
 */
function PrizeFinderLoader({
  source,
  packsById,
  onOpenPack,
}: {
  source: PrizeSource;
  packsById: Map<string, GachaPack>;
  onOpenPack: (packId: string) => void;
}) {
  const [prizes, setPrizes] = useState<GachaPrize[]>([]);
  const [status, setStatus] = useState<PrizeLoad>("idle");
  const [attempt, setAttempt] = useState(0);
  const anchor = useRef<HTMLDivElement>(null);
  // Once the prizes are in, nothing re-arms the observer. A ref, not `status`:
  // the effect must not re-run (and abort its own fetch) when status changes.
  const loaded = useRef(false);

  // Armed on mount and again by each retry (`attempt`).
  useEffect(() => {
    if (source.total === 0 || loaded.current) return;
    const el = anchor.current;
    if (!el) return;
    const ctrl = new AbortController();
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      setStatus("loading");
      fetch(source.route, { signal: ctrl.signal })
        .then((r) => r.json() as Promise<{ ok: boolean; data?: { prizes?: GachaPrize[] } }>)
        .then((j) => {
          if (!j.ok || !j.data?.prizes) throw new Error("prizes");
          loaded.current = true;
          setPrizes(j.data.prizes);
          setStatus("ready");
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setStatus("error");
        });
    };
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && load(), {
      rootMargin: "300px 0px",
    });
    io.observe(el);
    return () => {
      io.disconnect();
      ctrl.abort();
    };
  }, [source.route, source.total, attempt]);

  if (source.total === 0) return null;
  return (
    <div ref={anchor} data-finder-state={status}>
      <PrizeFinder
        prizes={prizes}
        source={source}
        status={status}
        onRetry={() => {
          setStatus("idle");
          setAttempt((n) => n + 1);
        }}
        packsById={packsById}
        onOpenPack={onOpenPack}
      />
    </div>
  );
}

function PrizeFinder({
  prizes,
  source,
  status,
  onRetry,
  packsById,
  onOpenPack,
}: {
  prizes: GachaPrize[];
  source: PrizeSource;
  status: PrizeLoad;
  onRetry: () => void;
  packsById: Map<string, GachaPack>;
  onOpenPack: (packId: string) => void;
}) {
  const vi = useVenues();
  const [q, setQ] = useState("");
  const [game, setGame] = useState<string>("all");
  const [platform, setPlatform] = useState<string>("all");
  const [sort, setSort] = useState<PrizeSort>("value");
  const [visible, setVisible] = useState(PRIZE_PAGE);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<PrizeGroup | null>(null);

  // close any filter menu on outside click
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-pill]")) setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openMenu]);

  // Every covered venue is a filter option — including one with no prizes, so
  // the reader can see that it publishes none rather than not find it at all.
  // From the payload's counts, so the menu is whole before the prizes load.
  const platforms = useMemo(
    () => [...new Set([...Object.keys(source.byVenue), ...vi.coveredKeys])].sort(
      (a, b) => vi.order(a) - vi.order(b),
    ),
    [source.byVenue, vi],
  );
  const games = useMemo(
    () => tabsFor(prizes.map((p) => ({ key: tabOf(p), label: packsById.get(p.packId)?.categoryLabel }))),
    [prizes, packsById],
  );

  // One card can sit in several pools (and at several prices) — group by the
  // card itself so the grid shows ONE slab with all the packs that pay it.
  // Pulled examples never merge with available pool entries.
  const groupKey = (p: GachaPrize) =>
    `${p.pulled ? "pulled" : "avail"}:${p.name ? p.name.toLowerCase().replace(/\s+/g, " ").trim() : `id:${p.id}`}:${p.grade ?? ""}`;

  const totalCards = useMemo(() => new Set(prizes.map(groupKey)).size, [prizes]);

  const groups = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = prizes.filter((p) => {
      if (game !== "all" && tabOf(p) !== game) return false;
      if (platform !== "all" && p.platform !== platform) return false;
      if (tokens.length) {
        // Name + every trait we hold + the token id itself — "psa 10", "lost
        // thunder", "japanese", "basketball", a mint, a tokenId all resolve.
        const hay = (
          `${p.name ?? ""} ${p.grade ?? ""} ${p.tier ?? ""} ${p.packName} ${p.platform} ` +
          `${p.category ?? "mixed"} ${p.id} ${(p.traits ?? []).join(" ")}`
        ).toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
    const byKey = new Map<string, GachaPrize[]>();
    for (const p of rows) {
      const k = groupKey(p);
      const arr = byKey.get(k);
      if (arr) arr.push(p);
      else byKey.set(k, [p]);
    }
    const out: PrizeGroup[] = [];
    for (const [key, members] of byKey) {
      // one entry per pack, cheapest pack first; representative = best art/value
      const byPack = new Map<string, GachaPrize>();
      for (const m of members) if (!byPack.has(m.packId)) byPack.set(m.packId, m);
      const packs = [...byPack.values()].sort((a, b) => a.priceUsd - b.priceUsd || b.fmvUsd - a.fmvUsd);
      const top = [...members].sort((a, b) => Number(!!b.image) - Number(!!a.image) || b.fmvUsd - a.fmvUsd)[0];
      out.push({ key, top, packs, minPrice: packs[0].priceUsd, maxFmv: Math.max(...members.map((m) => m.fmvUsd)) });
    }
    if (sort === "cheapest") out.sort((a, b) => a.minPrice - b.minPrice || b.maxFmv - a.maxFmv);
    else if (sort === "name") out.sort((a, b) => (a.top.name ?? "ÿ").localeCompare(b.top.name ?? "ÿ"));
    else out.sort((a, b) => b.maxFmv - a.maxFmv);
    return out;
  }, [prizes, q, game, platform, sort]);

  const shown = groups.slice(0, visible);
  const gameLabel = game === "all" ? "All" : games.find((t) => t.key === game)?.label ?? game;
  const platformLabel =
    platform === "all" ? "All" : vi.name(platform);
  const sortLabel = sort === "value" ? "Top value" : sort === "cheapest" ? "Cheapest pull" : "A–Z";

  const ready = status === "ready";

  return (
    <Section
      title={
        <>
          Find your <em className="not-italic text-yellow">chase</em>
        </>
      }
      subtitle="Prizes each venue advertises in its pool, and recent pulls where it publishes none · follow a card to what pays it"
      right={
        <span className="text-[11px] tabular text-ink-3">
          {!ready
            ? `${formatInt(source.total)} prizes${status === "error" ? "" : " · loading"}`
            : groups.length === totalCards
              ? `${formatInt(totalCards)} cards`
              : `${formatInt(groups.length)} of ${formatInt(totalCards)} cards`}
        </span>
      }
      className="mt-6"
    >
      {/* controls — one line: search + three compact menus */}
      <div className="mb-5 flex flex-wrap items-center gap-2 pt-1">
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setVisible(PRIZE_PAGE);
          }}
          placeholder="Search cards, sets, grades, types, token ID…"
          aria-label="Search prizes"
          className="h-10 w-full min-w-[220px] flex-1 rounded-xl border border-line bg-bg-1 px-3.5 text-[13px] text-ink placeholder:text-ink-4 focus:border-line-2 focus:outline-none sm:max-w-[420px]"
        />
        <FilterPill
          label="Game"
          value={gameLabel}
          open={openMenu === "game"}
          onToggle={() => setOpenMenu((m) => (m === "game" ? null : "game"))}
          options={[{ key: "all", label: "All" }, ...games].map((t) => ({ key: t.key, label: t.label }))}
          selected={game}
          onSelect={(k) => {
            setGame(k);
            setVisible(PRIZE_PAGE);
            setOpenMenu(null);
          }}
        />
        <FilterPill
          label="Venue"
          value={platformLabel}
          open={openMenu === "platform"}
          onToggle={() => setOpenMenu((m) => (m === "platform" ? null : "platform"))}
          options={[
            { key: "all", label: "All" },
            ...platforms.map((key) => ({
              key,
              label: vi.name(key),
              avatar: key,
            })),
          ]}
          selected={platform}
          onSelect={(k) => {
            setPlatform(k);
            setVisible(PRIZE_PAGE);
            setOpenMenu(null);
          }}
        />
        <FilterPill
          label="Sort"
          value={sortLabel}
          open={openMenu === "sort"}
          onToggle={() => setOpenMenu((m) => (m === "sort" ? null : "sort"))}
          options={[
            { key: "value", label: "Top value" },
            { key: "cheapest", label: "Cheapest pull" },
            { key: "name", label: "A–Z" },
          ]}
          selected={sort}
          onSelect={(k) => {
            setSort(k as PrizeSort);
            setVisible(PRIZE_PAGE);
            setOpenMenu(null);
          }}
        />
      </div>

      {/* grid — a placeholder of the first page's shape until the prizes land */}
      {status === "error" ? (
        <div className="rounded-xl border border-dashed border-line/70 px-6 py-12 text-center text-[12.5px] leading-relaxed text-ink-3" data-finder-error>
          The prizes did not load.{" "}
          <button type="button" onClick={onRetry} className="font-semibold text-ink-2 underline-offset-2 hover:text-yellow hover:underline">
            Try again
          </button>
        </div>
      ) : !ready ? (
        // The PrizeCard's own frame (3:4 art + its 114px text block) and the
        // "show more" row it will need, so the page below does not move.
        <div aria-busy="true">
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" data-finder-placeholder>
            {Array.from({ length: Math.min(PRIZE_PAGE, source.total) }, (_, i) => (
              <div key={i} className="rounded-xl border border-line bg-bg-1">
                <div className="aspect-[3/4] rounded-t-xl bg-bg-2" />
                <div className="h-[114px]" />
              </div>
            ))}
          </div>
          {source.total > PRIZE_PAGE ? <div className="mt-5 h-10" /> : null}
        </div>
      ) : shown.length > 0 ? (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {shown.map((g) => (
            <PrizeCard key={g.key} group={g} onExpand={() => setExpanded(g)} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-line/70 px-6 py-12 text-center text-[12.5px] leading-relaxed text-ink-3" data-finder-empty>
          {platform !== "all" && !(source.byVenue[platform] > 0)
            ? `No prize from ${vi.name(platform)} in this read: it advertises no pool here, and no recent pull of its was read.`
            : `No prize matches${q ? ` “${q}”` : " these filters"}. Try fewer words.`}
        </div>
      )}

      {groups.length > visible && (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={() => setVisible((v) => v + PRIZE_PAGE * 2)}
            className="h-10 rounded-xl border border-line-2 bg-bg-1 px-5 text-[12.5px] font-semibold text-ink-2 transition-colors hover:border-ink-4 hover:text-ink"
          >
            Show more · {formatInt(groups.length - visible)} left
          </button>
        </div>
      )}

      {expanded && (
        <PrizeModal
          group={expanded}
          packsById={packsById}
          onOpenPack={(id) => {
            setExpanded(null);
            onOpenPack(id);
          }}
          onClose={() => setExpanded(null)}
        />
      )}
    </Section>
  );
}

type PrizeGroup = {
  key: string;
  top: GachaPrize; // representative (best art / highest value)
  packs: GachaPrize[]; // one per pack holding this card, cheapest first
  minPrice: number;
  maxFmv: number;
};

/** Compact dropdown pill — label, current value, chevron; menu on click. */
function FilterPill({
  label,
  value,
  open,
  onToggle,
  options,
  selected,
  onSelect,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  options: { key: string; label: string; avatar?: string }[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="relative shrink-0" data-pill={label}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-10 items-center gap-1.5 rounded-xl border border-line bg-bg-1 px-3 text-[12px] transition-colors hover:border-line-2"
      >
        <span className="text-ink-4">{label}</span>
        <span className="font-semibold text-ink">{value}</span>
        <svg width="9" height="9" viewBox="0 0 10 10" className={`text-ink-4 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M2 3.5 L5 6.5 L8 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-30 min-w-[190px] rounded-xl border border-line-2 bg-bg-2 p-1.5 shadow-[0_18px_40px_rgba(0,0,0,.55)]">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => onSelect(o.key)}
              data-pill-option={o.key}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors hover:bg-bg-3 ${
                selected === o.key ? "font-semibold text-ink" : "text-ink-2"
              }`}
            >
              {o.avatar && <Avatar platform={o.avatar} short={o.label[0]} size={14} />}
              <span className="flex-1">{o.label}</span>
              {selected === o.key && <span className="text-yellow">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One CARD (possibly in several packs). The mechanic is taught explicitly: a
 * "Win this card →" CTA surfaces on hover, and — for a card sitting in several
 * packs — clicking opens an inline picker of every pack that pays it (price +
 * odds), each launching that pack's drawer. Single-pack cards open the drawer
 * straight away. No hidden tooltip carries the answer. ↗ goes to the card page.
 */
function PrizeCard({ group, onExpand }: { group: PrizeGroup; onExpand: () => void }) {
  const prize = group.top;
  const multi = group.packs.length > 1;
  const src = proxyImg(prize.image ?? undefined);
  // B1 (design-r1): the card-page ↗ is disabled — `prize.id` is a pool/prize id,
  // not a resolvable card token, so cardHref(...) 404s. Re-enable once the backend
  // exposes a verified card id (or resolvable flag) on GachaPrize. See PR summary.

  return (
    <div className="group relative rounded-xl border border-line bg-bg-1 transition-[border-color,transform] duration-100 hover:-translate-y-0.5 hover:border-line-2">
      <div
        role="button"
        tabIndex={0}
        onClick={onExpand}
        data-prize-card={group.packs.length}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onExpand();
          }
        }}
        className="block w-full cursor-pointer text-left"
      >
        <div className="relative aspect-[3/4] overflow-hidden rounded-t-xl bg-bg-2">
          {/* Whole slab, similar visual size across platforms: CC/Beezie serve
              tight slab scans (contain); Phygitals pedestal shots zoom to the slab. */}
          <CardArt
            src={src}
            imgClass={`absolute inset-0 h-full w-full ${
              prize.platform === "phygitals" ? "origin-[50%_38%] scale-[1.75] object-contain" : "object-contain p-2"
            }`}
          />
          {/* What this prize IS: still in an advertised pool, or a recent pull. */}
          {prize.pulled ? (
            <span
              title="A recent realized prize: what a pull paid, not a prize still in the pool"
              data-prize-badge="pulled"
              className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.06em] text-ink-3"
            >
              Pulled{pulledDay(prize.pulledAt) ? ` ${pulledDay(prize.pulledAt)}` : ""}
            </span>
          ) : (
            <span
              title="Advertised by the venue as in its pool"
              data-prize-badge="pool"
              className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.06em] text-ink-2"
            >
              In the pool{!multi && prize.tier ? ` · ${prize.tier}` : ""}
            </span>
          )}
          {/* explicit, discoverable CTA — click expands the card + its packs */}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/85 via-black/55 to-transparent pb-2 pt-7 text-[11px] font-bold text-yellow opacity-0 transition-opacity group-hover:opacity-100">
            {multi ? `Win it · ${group.packs.length} pools` : "Win this card"} <span aria-hidden>→</span>
          </span>
        </div>
        <div className="p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="tabular text-[16px] font-bold leading-none text-yellow">
              {formatCompactUsd(prize.fmvUsd)}
            </span>
            {prize.grade && <span className="shrink-0 text-[10px] font-semibold text-ink-3">{prize.grade}</span>}
          </div>
          <div className="mt-1.5 line-clamp-2 min-h-[34px] text-[12px] leading-snug text-ink-2" title={prize.name ?? undefined}>
            {prize.name ?? "Graded card (name pending)"}
          </div>
          <div className="mt-2 flex items-center gap-1.5 border-t border-line/60 pt-2 text-[10.5px] text-ink-3">
            {multi ? (
              <>
                <span className="flex -space-x-1">
                  {[...new Set(group.packs.map((p) => p.platform))].slice(0, 3).map((pl) => {
                    const sample = group.packs.find((p) => p.platform === pl)!;
                    return <Avatar key={pl} platform={pl} short={sample.platformShort} size={14} />;
                  })}
                </span>
                <span className="min-w-0 truncate">{group.packs.length} pools</span>
                <span className="ml-auto shrink-0 font-semibold text-ink-2 tabular">from {tierLabel(group.minPrice)}</span>
                <span className="shrink-0 text-ink-4 transition-colors group-hover:text-yellow" aria-hidden>→</span>
              </>
            ) : (
              <>
                <Avatar platform={prize.platform} short={prize.platformShort} size={14} />
                <span className="min-w-0 truncate">{prize.packName}</span>
                <span className="ml-auto shrink-0 font-semibold text-ink-2 tabular">{tierLabel(prize.priceUsd)}</span>
                <span className="shrink-0 text-ink-4 transition-colors group-hover:text-yellow" aria-hidden>→</span>
              </>
            )}
          </div>
        </div>
      </div>
      {/* card-page ↗ removed (B1) — pending a resolvable prize→card id from backend */}
    </div>
  );
}

/**
 * Expanded CARD view — opens when a prize card is clicked. The card is the hero
 * (big art + identity); below it, every pack that pays the card laid out as a
 * side-by-side spec sheet so the buyer can compare where to open: price, the
 * card's tier/band in that pool, hit odds, value-back, buyback, pack ceiling,
 * 24h activity and the odds audit. The best value in each row is flagged when
 * ≥2 packs. "Open full pack" drops into that pack's drawer for the deep odds.
 *
 * Honesty: no platform publishes a per-EXACT-card pull probability, so none is
 * shown — only the pack-level hit odds and the card's tier/band in each pool.
 */
function PrizeModal({
  group,
  packsById,
  onOpenPack,
  onClose,
}: {
  group: PrizeGroup;
  packsById: Map<string, GachaPack>;
  onOpenPack: (packId: string) => void;
  onClose: () => void;
}) {
  const vi = useVenues();
  const prize = group.top;
  // B1 (design-r1): card-page link disabled — `prize.id` is a pool/prize id, not a
  // resolvable card token (cardHref 404s). Re-enable with a verified backend card id.
  const src = proxyImg(prize.image ?? undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // one column per pack that pays this card, cheapest first
  const cols = group.packs.map((pp) => ({ prize: pp, pack: packsById.get(pp.packId) ?? null }));
  const multi = cols.length > 1;

  // value-back the row leads with: typical (median × buyback) when measured, else vendor net-EV
  const valueBack = (pk: GachaPack | null): number | null => {
    if (!pk) return null;
    const med = leadMedian(pk);
    if (med != null) return med.value * (pk.buybackPct ?? 1);
    return netEv(pk);
  };
  // expected value in $ per pack: published $EV (vendor) where we have it, else
  // the measured EV multiple × price.
  const evUsd = (pk: GachaPack | null): number | null => {
    if (!pk) return null;
    if (pk.evStatedUsd != null) return pk.evStatedUsd;
    const e = leadEv(pk);
    return e != null ? e.value * pk.priceUsd : null;
  };

  type Row = {
    label: string;
    best?: "max" | "min";
    num: (c: (typeof cols)[number]) => number | null;
    render: (c: (typeof cols)[number]) => ReactNode;
  };
  const rows: Row[] = [
    {
      label: "Price",
      best: "min",
      num: (c) => c.prize.priceUsd,
      render: (c) => <span className="tabular font-semibold text-ink">{tierLabel(c.prize.priceUsd)}</span>,
    },
    {
      label: "This card sits in",
      num: () => null,
      render: (c) =>
        c.prize.tier ? (
          <span className="font-semibold text-ink">{c.prize.tier} tier</span>
        ) : c.prize.pulled ? (
          <span className="text-ink-3">pulled{pulledDay(c.prize.pulledAt) ? ` ${pulledDay(c.prize.pulledAt)}` : ""}</span>
        ) : (
          <span className="text-ink-3">in the pool</span>
        ),
    },
    {
      label: "Hit odds",
      best: "max",
      num: (c) => (c.pack ? leadHitOdds(c.pack)?.value ?? null : null),
      render: (c) => {
        const o = c.pack ? leadHitOdds(c.pack) : null;
        return o ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="tabular font-semibold">{pct(o.value)}</span>
            <Dot basis={o.basis} n={o.n} />
          </span>
        ) : (
          <span className="text-ink-4">—</span>
        );
      },
    },
    {
      label: "Expected value",
      best: "max",
      num: (c) => evUsd(c.pack),
      render: (c) => {
        const v = evUsd(c.pack);
        return v != null ? (
          <span className="tabular font-semibold">
            ${formatInt(Math.round(v))}
            <span className="ml-1 text-[10px] text-ink-4">/pull</span>
          </span>
        ) : (
          <span className="text-ink-4">—</span>
        );
      },
    },
    {
      label: "Value back · typical",
      best: "max",
      num: (c) => valueBack(c.pack),
      render: (c) => {
        const v = valueBack(c.pack);
        return v != null ? <span className="tabular font-semibold">{v.toFixed(2)}×</span> : <span className="text-ink-4">—</span>;
      },
    },
    {
      label: "Instant buyback",
      best: "max",
      num: (c) => c.pack?.buybackPct ?? null,
      render: (c) =>
        c.pack?.buybackPct != null ? (
          <span className="tabular font-semibold">{Math.round(c.pack.buybackPct * 100)}%</span>
        ) : (
          <span className="text-ink-4">—</span>
        ),
    },
    {
      label: "Top prize",
      best: "max",
      num: (c) => (c.pack ? chaseUsd(c.pack) : null),
      render: (c) => {
        const v = c.pack ? chaseUsd(c.pack) : null;
        return v != null ? <span className="tabular font-semibold text-yellow">{formatCompactUsd(v)}</span> : <span className="text-ink-4">—</span>;
      },
    },
    {
      label: "Opened · 24h",
      best: "max",
      num: (c) => c.pack?.pulls24h ?? null,
      render: (c) =>
        c.pack?.pulls24h != null ? (
          <span className="tabular">{`${c.pack.pulls24hEstimated ? "~" : ""}${formatInt(c.pack.pulls24h)}`}</span>
        ) : (
          <span className="text-ink-4">—</span>
        ),
    },
    {
      label: "Odds audit",
      num: () => null,
      render: (c) => {
        const a = c.pack ? oddsAudit(c.pack) : null;
        if (!a) return <span className="text-ink-4">—</span>;
        if (a.verdict === "thin") return <span className="text-ink-4">verifying</span>;
        return a.verdict === "match" ? (
          <span className="font-semibold text-green">✓ matches</span>
        ) : (
          <span className="font-semibold text-amber">{`⚠ ${a.deltaPts > 0 ? "+" : ""}${a.deltaPts.toFixed(1)}pts`}</span>
        );
      },
    },
  ];

  const leaders = (row: Row): Set<number> => {
    if (!row.best || cols.length < 2) return new Set();
    const vals = cols.map(row.num);
    const present = vals.filter((v): v is number => v != null);
    if (present.length < 2 || new Set(present.map((v) => +v.toFixed(4))).size < 2) return new Set();
    const target = row.best === "max" ? Math.max(...present) : Math.min(...present);
    const out = new Set<number>();
    vals.forEach((v, i) => {
      if (v != null && +v.toFixed(4) === +target.toFixed(4)) out.add(i);
    });
    return out;
  };

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-[3px]" />
      <div
        role="dialog"
        aria-modal="true"
        data-prize-modal
        aria-label={`Win ${prize.name ?? "this card"}`}
        className="fixed left-1/2 top-1/2 z-[61] flex max-h-[90vh] w-[min(94vw,1040px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-line-2 bg-bg shadow-[0_30px_80px_rgba(0,0,0,.6)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg border border-line-2 bg-bg-2 text-ink-2 hover:border-ink-4 hover:text-ink"
        >
          ✕
        </button>

        <div className="overflow-y-auto p-6 sm:p-7">
          {/* hero: big card + identity */}
          <div className="flex flex-col gap-5 sm:flex-row sm:gap-7">
            <div className="relative mx-auto aspect-[3/4] w-[200px] shrink-0 overflow-hidden rounded-xl border border-line bg-bg-2 sm:mx-0">
              <CardArt
                src={src}
                imgClass={`absolute inset-0 h-full w-full ${
                  prize.platform === "phygitals" ? "origin-[50%_38%] scale-[1.6] object-contain" : "object-contain p-2"
                }`}
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-4">
                {prize.pulled ? `A recent pull${pulledDay(prize.pulledAt) ? ` · ${pulledDay(prize.pulledAt)}` : ""}` : "In the pool"}
              </div>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="tabular text-[30px] font-bold leading-none text-yellow">{formatCompactUsd(prize.fmvUsd)}</span>
                {prize.grade && <span className="text-[13px] font-semibold text-ink-3">{prize.grade}</span>}
              </div>
              <h3 className="mt-2.5 text-[16px] font-semibold leading-snug text-ink">{prize.name ?? "Graded card (name pending)"}</h3>
              <div className="mt-1 text-[12px] text-ink-3">{catLabelOf(prize.category)}</div>
              {/* "Full card page ↗" removed (B1) — prize.id isn't a resolvable card
                  token; re-enable when the backend provides a verified card id. */}
              <div className="mt-5 text-[12.5px] text-ink-2">
                {prize.pulled ? (
                  <>
                    A prize {vi.name(prize.platform)} paid on a recent pull, not one still in a pool. It came from:
                  </>
                ) : multi ? (
                  <>
                    In <span className="font-semibold text-ink">{cols.length} pools</span> — compare where to pull it:
                  </>
                ) : (
                  <>Win it from this {kindNoun(vi.kind(prize.platform))}:</>
                )}
              </div>
            </div>
          </div>

          {/* side-by-side pack spec sheet */}
          <div className="mt-6 overflow-x-auto">
            <div
              className="grid min-w-max gap-x-3 gap-y-0"
              style={{ gridTemplateColumns: `minmax(132px,max-content) repeat(${cols.length}, minmax(150px,1fr))` }}
            >
              {/* header row */}
              <div className="sticky left-0 bg-bg" />
              {cols.map((c) => (
                <div key={`h-${c.prize.packId}`} className="border-b border-line-2 px-3 pb-3">
                  <div className="flex items-center gap-2">
                    <Avatar platform={c.prize.platform} short={c.prize.platformShort} size={20} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-bold text-ink">{c.prize.packName}</div>
                      <div className="text-[10px] text-ink-4">{vi.name(c.prize.platform)}</div>
                    </div>
                  </div>
                </div>
              ))}

              {/* metric rows */}
              {rows.map((row) => {
                const lead = leaders(row);
                return (
                  <Fragment key={row.label}>
                    <div className="sticky left-0 flex items-center border-b border-line/50 bg-bg py-2.5 text-[11.5px] text-ink-3">
                      {row.label}
                    </div>
                    {cols.map((c, i) => (
                      <div
                        key={`${row.label}-${c.prize.packId}`}
                        className={`flex items-center border-b border-line/50 px-3 py-2.5 text-[13px] ${
                          lead.has(i) ? "text-yellow" : "text-ink-2"
                        }`}
                      >
                        {lead.has(i) ? <span className="font-semibold text-yellow">{row.render(c)}</span> : row.render(c)}
                      </div>
                    ))}
                  </Fragment>
                );
              })}

              {/* live odds — value-band distribution, IN-LINE as the breakdown row */}
              {cols.some((c) => (c.pack?.oddsStated ?? c.pack?.valueBands)?.length) && (
                <Fragment>
                  <div className="sticky left-0 self-start border-t border-line/50 bg-bg py-3 pr-3 text-[11.5px] text-ink-3">
                    Live odds
                    <div className="mt-0.5 text-[10px] leading-tight text-ink-4">$ value you&apos;ll pull</div>
                  </div>
                  {cols.map((c) => (
                    <div key={`lo-${c.prize.packId}`} className="self-start border-t border-line/50 px-3 py-3">
                      <LiveOddsBands pack={c.pack} />
                    </div>
                  ))}
                </Fragment>
              )}

              {/* action row */}
              <div className="sticky left-0 bg-bg" />
              {cols.map((c) => (
                <div key={`a-${c.prize.packId}`} className="px-3 pt-4">
                  <button
                    type="button"
                    onClick={() => onOpenPack(c.prize.packId)}
                    className="w-full rounded-lg bg-yellow px-3 py-2 text-[12px] font-bold text-black transition-[filter] hover:brightness-110"
                  >
                    Open full details →
                  </button>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-4">
            Under <span className="text-ink-3">Live odds</span>, bands in yellow return at least what you paid. Stated
            odds are each platform&apos;s published distribution.
          </p>
        </div>
      </div>
    </>
  );
}

/** A pack's value-band odds as labelled bars — the per-pack "LIVE ODDS" panel.
 *  Stated $-range bands (all platforms now) preferred; realized multiples else.
 *  Ordered low→high value to match the platforms' own panels. */
function LiveOddsBands({ pack }: { pack: GachaPack | null }) {
  const bands = pack?.oddsStated ?? pack?.valueBands ?? null;
  if (!bands || !bands.length) return <div className="text-[11.5px] text-ink-4">No published odds.</div>;
  const display = [...bands].sort((a, b) => (a.minUsd ?? 0) - (b.minUsd ?? 0));
  return (
    <div className="space-y-2">
      {display.map((b) => {
        const isRangeLabel = b.label.startsWith("$");
        const range =
          !isRangeLabel && b.minUsd != null && b.maxUsd != null
            ? `${formatCompactUsd(b.minUsd)}–${formatCompactUsd(b.maxUsd).replace("$", "")}`
            : null;
        return (
          <div key={b.label}>
            <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
              <span className={`min-w-0 truncate ${b.hit ? "text-ink-2" : "text-ink-4"}`}>
                {b.label}
                {range && <span className="text-ink-4"> · {range}</span>}
              </span>
              <span className={`tabular shrink-0 font-semibold ${b.hit ? "text-ink" : "text-ink-3"}`}>{pct(b.pct, 1)}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-none bg-bg-3">
              <i
                className="block h-full rounded-none"
                style={{ width: `${Math.max(2, Math.min(100, b.pct * 100))}%`, background: b.hit ? "var(--color-yellow)" : "var(--color-line-2)" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 3" — a pulled prize's date, from the payload; "" when it carries none. */
function pulledDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${MON3[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
function catLabelOf(cat: string | null): string {
  if (cat === "pokemon") return "Pokémon";
  if (cat === "one_piece") return "One Piece";
  if (cat === "sports") return "Sports";
  return "Mixed / other";
}

/* ───────────────────────── matrix cell ───────────────────────── */

function MatrixCell({
  pack,
  extra,
  best,
  pinned,
  kind,
  onOpen,
  onPin,
}: {
  pack: GachaPack;
  extra: number;
  best: boolean;
  pinned: boolean;
  /** The venue's word for this product (Claw, Machine, Pack, Box), from the payload. */
  kind: VenueKind | null;
  onOpen: () => void;
  onPin: () => void;
}) {
  const odds = leadHitOdds(pack);
  const thin = isThin(odds);
  const vb = valueBack(pack);
  const ceiling = chaseUsd(pack);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      data-cell={pack.id}
      data-cell-venue={pack.platform}
      title={`${pack.name} · ${pack.platformName}${extra > 0 ? ` (+${extra} more at this price — open to step through)` : ""}${pack.realizedValueBasis ? ` · measured values in ${pack.realizedValueBasis}` : ""}${pack.medianWithheld ? ` · median withheld: ${pack.medianWithheld}` : ""}`}
      className={`group relative h-[92px] w-[140px] shrink-0 cursor-pointer rounded-xl border px-[13px] py-[11px] text-left font-mono transition-[border-color,transform,background] duration-100 hover:-translate-y-0.5 ${
        pinned ? "border-yellow" : best ? "border-yellow" : "border-line bg-bg-1 hover:border-line-2"
      }`}
      style={best ? { background: "linear-gradient(180deg, rgba(191,239,1,.10), transparent 78%)" } : undefined}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPin();
        }}
        title={pinned ? "Remove from compare" : "Add to compare"}
        data-pin={pack.id}
        className={`absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-md border text-[13px] leading-none transition-opacity ${
          pinned
            ? "border-yellow bg-yellow font-bold text-black opacity-100"
            : "border-line-2 bg-bg-2 text-ink-3 opacity-0 hover:border-ink-4 hover:text-ink group-hover:opacity-100"
        }`}
      >
        {pinned ? "✓" : "+"}
      </button>
      {extra > 0 && (
        <span className="absolute right-[34px] top-2.5 text-[9px] font-semibold text-ink-4">+{extra}</span>
      )}
      <div className="flex items-baseline gap-1">
        <span
          className={`text-[21px] font-bold leading-none ${best && !thin ? "text-yellow" : thin ? "text-ink-3" : "text-ink"}`}
        >
          {odds ? pct(odds.value, 0).replace("%", "") : "—"}
        </span>
        {odds && <span className="text-[11px] font-medium text-ink-3">%</span>}
        {odds && (
          <span className="ml-0.5 self-center">
            <Dot basis={odds.basis} n={odds.n} />
          </span>
        )}
      </div>
      <div className="mt-1 text-[8.5px] uppercase tracking-[0.08em] text-ink-4">{kind ? `${KIND_WORD[kind].one} · ` : ""}hit odds</div>
      <div className="mt-[9px] flex items-end justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] text-ink-2">
          <span className="text-[9px] uppercase text-ink-4">top </span>
          {ceiling != null ? formatCompactUsd(ceiling) : "—"}
        </span>
        {vb != null && (
          <span
            className="flex shrink-0 flex-col items-end gap-[3px]"
            title={`value-back: a ${vb.basis === "realized" ? "typical (median)" : "vendor-average"} pull returns ${vb.value.toFixed(2)}× the price`}
          >
            <span className="text-[9px] leading-none text-ink-3">{vb.value.toFixed(2)}×</span>
            <span className="h-[3px] w-10 overflow-hidden rounded-sm bg-bg-3">
              <i
                className={`block h-full rounded-sm ${best ? "bg-yellow" : "bg-ink-3"}`}
                style={{ width: `${Math.min(100, vb.value * 70)}%` }}
              />
            </span>
          </span>
        )}
      </div>
    </div>
  );
}


/** A matrix cell holding 2+ live packs at the same (platform, price): each pack
 *  is a compact, individually-openable row (name + hit odds) so both are
 *  visible at a glance rather than collapsed behind a "+N". Best-odds row wins
 *  the column highlight. Rare — only when a platform genuinely runs multiple
 *  live packs at one price (e.g. two $500 Pokémon machines). */
function MatrixCellMulti({
  packs,
  colBest,
  onOpen,
}: {
  packs: GachaPack[];
  colBest: number | undefined;
  onOpen: (id: string) => void;
}) {
  const shown = packs.slice(0, 3);
  const more = packs.length - shown.length;
  const cellBest = packs.some((p) => (leadHitOdds(p)?.value ?? -1) === colBest);
  return (
    <div
      className={`relative flex h-[92px] w-[140px] shrink-0 flex-col rounded-xl border px-2 py-2 ${
        cellBest ? "border-yellow" : "border-line bg-bg-1"
      }`}
      style={cellBest ? { background: "linear-gradient(180deg, rgba(191,239,1,.10), transparent 78%)" } : undefined}
    >
      <div className="mb-1 px-1 text-[8.5px] uppercase tracking-[0.08em] text-ink-4">{packs.length} at this price</div>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-0.5">
        {shown.map((p) => {
          const o = leadHitOdds(p);
          const isBest = (o?.value ?? -1) === colBest && colBest != null;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onOpen(p.id)}
              title={`${p.name} · ${pct(o?.value ?? null)} hit odds — open`}
              className="group/r flex items-center justify-between gap-1.5 rounded-md px-1 py-1 text-left transition-colors hover:bg-bg-2"
            >
              <span className="min-w-0 truncate text-[10.5px] text-ink-2 transition-colors group-hover/r:text-ink">
                {p.name}
              </span>
              <span className={`tabular shrink-0 text-[12.5px] font-bold ${isBest ? "text-yellow" : "text-ink"}`}>
                {o ? pct(o.value, 0) : "—"}
              </span>
            </button>
          );
        })}
        {more > 0 && <div className="px-1 text-[9px] text-ink-4">+{more} more</div>}
      </div>
    </div>
  );
}

/** ‹ / › — one frame of prices lower or higher. */
function BandButton({ dir, disabled, onClick }: { dir: 1 | -1; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === 1 ? "Higher prices" : "Lower prices"}
      data-band-step={dir}
      className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-bg-2 text-[14px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink disabled:cursor-default disabled:opacity-35 disabled:hover:border-line disabled:hover:text-ink-2"
    >
      {dir === 1 ? "›" : "‹"}
    </button>
  );
}

/** The public odds audit: published hit rate vs what we measured on-chain.
 *  Wilson 95% interval — "matches" only when the stated rate survives it. */
function AuditLine({ pack }: { pack: GachaPack }) {
  const a = oddsAudit(pack);
  if (!a) return null;
  if (a.verdict === "thin")
    return (
      <div
        className="mt-2.5 flex items-center justify-between text-[11.5px] text-ink-4"
        title={`Needs ${AUDIT_MIN_N}+ measured pulls for a verdict`}
      >
        <span>Odds audit</span>
        <span>verifying · n={a.n}</span>
      </div>
    );
  const off = a.verdict === "off";
  return (
    <div
      className="mt-2.5 flex items-center justify-between text-[11.5px]"
      title={`Published hit odds ${pct(a.stated)} · measured ${pct(a.measured)} over ${a.n} pulls (95% confidence)`}
    >
      <span className="text-ink-3">Odds audit</span>
      <span className={`font-semibold ${off ? "text-amber" : "text-green"}`}>
        {off ? `⚠ ${a.deltaPts > 0 ? "+" : ""}${a.deltaPts.toFixed(1)}pts vs stated` : "✓ matches stated"}
        <span className="ml-1.5 font-normal text-ink-4">n={a.n}</span>
      </span>
    </div>
  );
}

/* ───────────────────────── drawer ───────────────────────── */

function PackDrawer({
  pack,
  siblings,
  pinned,
  onStep,
  onPin,
  onClose,
}: {
  pack: GachaPack | null;
  siblings: string[];
  pinned: boolean;
  onStep: (id: string) => void;
  onPin: () => void;
  onClose: () => void;
}) {
  // keep the last pack rendered during the slide-out transition — the
  // render-phase "adjust state when props change" pattern from the React docs
  const vi = useVenues();
  const [lastPack, setLastPack] = useState<GachaPack | null>(null);
  if (pack && pack !== lastPack) setLastPack(pack);
  const d = pack ?? lastPack;
  const open = pack != null;

  const scrollRef = useRef<HTMLDivElement>(null);
  const packId = pack?.id;
  useEffect(() => {
    if (open) scrollRef.current?.scrollTo(0, 0);
  }, [open, packId]);

  if (!d)
    return (
      <>
        <div className="pointer-events-none fixed inset-0 z-40 bg-black/60 opacity-0 transition-opacity" />
      </>
    );

  const idx = siblings.indexOf(d.id);
  const odds = leadHitOdds(d);
  const thinOdds = isThin(odds);
  const med = leadMedian(d);
  const ev = leadEv(d);
  const ceiling = chaseUsd(d);
  const hit = d.topHitsAvailable[0] ?? d.topHitRealized ?? null;
  const hitIsRealized = d.topHitsAvailable.length === 0 && d.topHitRealized != null;
  const art = proxyImg(hit?.image ?? undefined);
  const link = hit?.id && cardSupported(d.platform) ? cardHref(d.platform, hit.id) : null;
  const bands = d.oddsStated ?? d.valueBands ?? d.oddsRealized;
  const bandsStated = d.oddsStated != null;
  // Stated band rows show our measured share beside them when we hold both
  // sides (CC) — labels align because both derive from the same tier order.
  const measuredByLabel = new Map((d.oddsRealized ?? []).map((o) => [o.label, o.pct]));
  const cashCards = med != null ? med.value * d.priceUsd : null;
  const cashInstant = cashCards != null && d.buybackPct != null ? cashCards * d.buybackPct : null;

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[51] bg-black/60 backdrop-blur-[3px] transition-opacity duration-250 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      {/* Below lg a bottom sheet (thumb reach, one hand); at lg a side drawer. */}
      <aside
        ref={scrollRef}
        aria-hidden={!open}
        data-pack-drawer={open ? d.id : ""}
        className={`fixed inset-x-0 bottom-0 z-[55] h-[88vh] w-full overflow-y-auto rounded-t-xl border-t border-line-2 bg-bg-1 transition-transform duration-300 ease-[cubic-bezier(.22,1,.36,1)] lg:inset-x-auto lg:bottom-auto lg:right-0 lg:top-0 lg:h-screen lg:w-[540px] lg:max-w-[94vw] lg:rounded-none lg:border-l lg:border-t-0 ${
          open ? "translate-y-0 lg:translate-x-0" : "translate-y-full lg:translate-y-0 lg:translate-x-full"
        }`}
      >
        {/* sticky header */}
        <div className="sticky top-0 z-[2] flex items-center gap-3 border-b border-line bg-bg-1 px-6 py-[18px]">
          <div className="flex items-center gap-[11px]">
            <Avatar platform={d.platform} short={d.platformShort} size={34} />
            <div>
              <div className="text-[15px] font-bold">{d.name}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">
                <span className="tabular">{tierLabel(d.priceUsd)}</span>
                {` · ${d.categoryLabel} · ${vi.name(d.platform)}${vi.kind(d.platform) ? ` · ${KIND_WORD[vi.kind(d.platform)!].one}` : ""}`}
              </div>
              {/* Whose value a measured return is priced in: every venue's realized
                  figures rest on its own value marks (insured value, FMV, stated
                  prize value), never on an outside price. */}
              {d.realizedValueBasis ? (
                <div className="mt-1 font-mono text-[10.5px] text-ink-4" data-value-basis>
                  measured values in {d.realizedValueBasis}
                </div>
              ) : null}
              {d.medianWithheld ? (
                <div className="mt-1 font-mono text-[10.5px] text-ink-4" data-withheld>
                  median withheld · {d.medianWithheld}
                </div>
              ) : null}
            </div>
          </div>
          <div className="ml-auto flex gap-1">
            <button
              type="button"
              disabled={idx <= 0}
              onClick={() => onStep(siblings[idx - 1])}
              className="grid h-8 w-8 place-items-center rounded-xl border border-line text-ink-2 hover:border-line-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
            >
              ‹
            </button>
            <button
              type="button"
              disabled={idx < 0 || idx >= siblings.length - 1}
              onClick={() => onStep(siblings[idx + 1])}
              className="grid h-8 w-8 place-items-center rounded-xl border border-line text-ink-2 hover:border-line-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
            >
              ›
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-xl border border-line text-ink-2 hover:border-line-2 hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="p-6">
          {/* hero */}
          <div className="flex items-center gap-[18px] border-b border-line pb-[22px]">
            {/* Whole slab, uncropped: contain (+ padding) for tight CC/Beezie
                scans; zoom for Phygitals pedestal shots; gradient on dead art. */}
            <div className="relative h-[126px] w-[92px] shrink-0 overflow-hidden rounded-xl border border-line-2 bg-bg-2">
              <CardArt
                src={art ?? undefined}
                imgClass={`absolute inset-0 h-full w-full ${
                  d.platform === "phygitals" ? "origin-[50%_38%] scale-[1.6] object-contain" : "object-contain p-1.5"
                }`}
              />
              {!art && hit?.grade && (
                <span className="absolute bottom-1.5 left-1.5 rounded-md bg-yellow px-1 py-0.5 text-[8px] font-bold text-black">
                  {hit.grade}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.12em] text-ink-4">
                {hitIsRealized ? "Biggest pulled · ceiling so far" : "Top hit · the ceiling"}
                {hitIsRealized && <Dot basis="realized" n={d.realizedN} />}
              </div>
              <div className="mt-1.5 text-[28px] font-bold leading-none tracking-[-0.01em] text-yellow tabular">
                {ceiling != null ? formatCompactUsd(ceiling) : "—"}
              </div>
              {hit?.name && (
                <div className="mt-2 truncate text-[12px] text-ink-2" title={hit.name}>
                  {hit.name}
                </div>
              )}
              {link && (
                <Link href={link} className="mt-3 inline-flex items-center gap-[5px] text-[12px] text-yellow">
                  view card →
                </Link>
              )}
            </div>
          </div>

          {/* metric tiles */}
          <div className="my-[22px] grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">
            <MetTile
              k="Hit odds"
              v={odds ? pct(odds.value) : "—"}
              tone={thinOdds ? "dim" : "lime"}
              barPct={odds ? Math.min(100, odds.value * 400) : 0}
              barColor="var(--color-yellow)"
              basis={odds?.basis}
              n={odds?.n}
            />
            <MetTile
              k="Instant buyback"
              v={d.buybackPct != null ? `${Math.round(d.buybackPct * 100)}%` : "—"}
              tone="green"
              barPct={d.buybackPct != null ? d.buybackPct * 100 : 0}
              barColor="var(--color-green)"
              basis={d.buybackPct != null ? d.buybackBasis : undefined}
            />
            {d.poolDepth != null ? (
              <MetTile
                k="Prizes in pool"
                v={formatInt(d.poolDepth)}
                barPct={Math.min(100, d.poolDepth)}
                barColor="var(--color-ink-3)"
              />
            ) : (
              <MetTile
                k="Opened · 24h"
                v={d.pulls24h != null ? `${d.pulls24hEstimated ? "~" : ""}${formatInt(d.pulls24h)}` : "—"}
                barPct={d.pulls24h != null ? Math.min(100, (d.pulls24h / 100) * 10) : 0}
                barColor="var(--color-ink-3)"
              />
            )}
            <MetTile
              k="Value back · typ"
              v={med != null ? `${med.value.toFixed(2)}×` : ev != null ? `${ev.value.toFixed(2)}×` : "—"}
              tone={med != null && isThin(med) ? "dim" : undefined}
              barPct={Math.min(100, (med?.value ?? ev?.value ?? 0) * 70)}
              barColor="var(--color-ink-2)"
              basis={(med ?? ev)?.basis}
              n={(med ?? ev)?.n}
            />
          </div>

          {/* odds breakdown — the platform's NATIVE bands */}
          {bands && (
            <div className="mt-[26px]">
              <h4 className="mb-3.5 text-[10.5px] font-medium uppercase tracking-[0.13em] text-ink-3">
                Odds {bandsStated ? "· stated" : `· measured n=${d.realizedN ?? "?"}`}
              </h4>
              {bands.map((b) => {
                const m = bandsStated ? measuredByLabel.get(b.label) : undefined;
                return (
                  <div key={b.label} className="grid grid-cols-[96px_1fr_88px] items-center gap-3 py-1.5 text-[13px]">
                    <span className="flex items-center gap-[9px] text-ink">
                      <span
                        className="h-[7px] w-[7px] rounded-none"
                        style={{ background: b.hit ? "var(--color-amber)" : "var(--color-ink-4)" }}
                      />
                      {b.label}
                    </span>
                    <span className="h-[5px] overflow-hidden rounded-md bg-bg-3">
                      <i
                        className="block h-full"
                        style={{ width: `${Math.min(100, b.pct * 100)}%`, background: b.hit ? "var(--color-amber)" : "var(--color-ink-4)" }}
                      />
                    </span>
                    <span className="text-right tabular text-ink-2">
                      {pct(b.pct, 2)}
                      {m != null && (
                        <span className="ml-1.5 text-[10.5px] text-ink-4" title={`measured ${pct(m, 2)} on-chain`}>
                          {pct(m, 1)}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
              <AuditLine pack={d} />
            </div>
          )}

          {/* what you get back */}
          <div className="mt-[26px]">
            <h4 className="mb-3.5 text-[10.5px] font-medium uppercase tracking-[0.13em] text-ink-3">
              What you get back
            </h4>
            <KV k="Typical pull · median" v={med != null ? `${med.value.toFixed(2)}×` : "—"} basis={med?.basis} n={med?.n} />
            <KV
              k="Average pull · mean"
              v={ev != null ? `${ev.value.toFixed(2)}×` : "—"}
              hint={ev != null ? "jackpot-skewed" : undefined}
              basis={ev?.basis}
              n={ev?.n}
            />
            {/* No buyback published (Renaiss) → no "net of buyback" figure: netEv
                falls back to the gross mean, which this label would misstate. */}
            <KV
              k="Mean · net of buyback"
              v={d.buybackPct != null && netEv(d) != null ? `${netEv(d)!.toFixed(2)}×` : "—"}
              hint={d.buybackPct == null ? "no buyback published" : undefined}
            />
            {cashCards != null && (
              <KV
                k="Cash out a typical pull"
                v={`~${formatCompactUsd(cashCards)} in cards${cashInstant != null ? ` · ${formatCompactUsd(cashInstant)} instant` : ""}`}
                lime
              />
            )}
          </div>

          {/* this pack */}
          <div className="mt-[26px]">
            <h4 className="mb-3.5 text-[10.5px] font-medium uppercase tracking-[0.13em] text-ink-3">This {kindNoun(vi.kind(d.platform))}</h4>
            {d.topHitRealizedUsd != null && (
              <KV k="Biggest pulled so far" v={formatCompactUsd(d.topHitRealizedUsd)} lime basis="realized" n={d.realizedN} />
            )}
            {d.poolDepth != null && <KV k="Prizes in pool" v={formatInt(d.poolDepth)} />}
            {d.stockCount != null && <KV k="In stock" v={d.stockCount > 0 ? formatInt(d.stockCount) : "sold out"} />}
            {d.pulls24h != null && (
              <KV k="Opened · 24h" v={`${d.pulls24hEstimated ? "~" : ""}${formatInt(d.pulls24h)}`} hint={d.pulls24hEstimated ? "rate est." : undefined} />
            )}
            {d.realizedN != null && <KV k="Sample measured" v={`n=${formatInt(d.realizedN)}${d.realizedWindow ? ` · ${d.realizedWindow}` : ""}`} />}
          </div>

          {/* CTA */}
          <div className="mt-[26px] flex gap-2.5">
            <button
              type="button"
              onClick={onPin}
              className={`h-12 flex-1 rounded-xl text-[13.5px] font-bold ${
                pinned ? "border border-yellow bg-bg-2 text-yellow" : "bg-yellow text-black hover:brightness-110"
              }`}
            >
              {pinned ? "✓ Added to compare" : "+ Add to compare"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function MetTile({
  k,
  v,
  tone,
  barPct,
  barColor,
  basis,
  n,
}: {
  k: string;
  v: string;
  tone?: "lime" | "green" | "dim";
  barPct: number;
  barColor: string;
  basis?: MetricBasis;
  n?: number | null;
}) {
  const toneCls = tone === "lime" ? "text-yellow" : tone === "green" ? "text-green" : tone === "dim" ? "text-ink-3" : "text-ink";
  return (
    <div className="bg-bg-1 px-4 py-[15px]">
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.1em] text-ink-4">
        {k} {basis && <Dot basis={basis} n={n} />}
      </div>
      <div className={`mt-2 text-[23px] font-bold leading-none tabular ${toneCls}`}>{v}</div>
      <div className="mt-[11px] h-1 overflow-hidden rounded-sm bg-bg-3">
        <i className="block h-full rounded-sm" style={{ width: `${Math.max(0, Math.min(100, barPct))}%`, background: barColor }} />
      </div>
    </div>
  );
}

function KV({
  k,
  v,
  hint,
  lime,
  basis,
  n,
}: {
  k: string;
  v: string;
  hint?: string;
  lime?: boolean;
  basis?: MetricBasis;
  n?: number | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3.5 border-b border-line py-2 text-[13px] last:border-b-0">
      <span className="text-ink-2">{k}</span>
      <span className={`flex items-center gap-1.5 text-right font-semibold tabular ${lime ? "text-yellow" : "text-ink"}`}>
        {v}
        {hint && <span className="text-[11px] font-normal text-ink-3">{hint}</span>}
        {basis && <Dot basis={basis} n={n} />}
      </span>
    </div>
  );
}

/* ───────────────────────── compare overlay ───────────────────────── */

type CmpCell = { raw: number | null; text: string; unit?: string; basis?: MetricBasis; n?: number | null; sub?: string; tone?: "good" | "warn" };
type CmpRow = { label: string; sub?: string; flag?: boolean; cell: (p: GachaPack) => CmpCell };
type CmpGroup = { name: string; rows: CmpRow[] };

const BAND_LABELS = ["5×+", "2–5×", "1–2×", "½–1×", "<½×"];

function cmpGroups(norm: "abs" | "dollar"): CmpGroup[] {
  const band = (label: string): CmpRow => ({
    label,
    flag: false, // distribution shape is a judgment, not a max
    cell: (p) => {
      const b = p.valueBands?.find((x) => x.label === label);
      return b
        ? { raw: b.pct, text: pct(b.pct, 1).replace("%", ""), unit: "%", basis: "realized", n: p.realizedN }
        : { raw: null, text: "—" };
    },
  });
  return [
    {
      name: "Your shot",
      rows: [
        {
          label: "Hit odds",
          sub: "chance ≥1× back",
          cell: (p) => {
            const o = leadHitOdds(p);
            return o
              ? { raw: o.value, text: pct(o.value).replace("%", ""), unit: "%", basis: o.basis, n: o.n }
              : { raw: null, text: "—" };
          },
        },
        {
          label: "Odds audit",
          sub: "stated vs measured",
          flag: false,
          cell: (p) => {
            const a = oddsAudit(p);
            if (!a) return { raw: null, text: "—" };
            if (a.verdict === "thin") return { raw: null, text: "…", sub: `n=${a.n}` };
            return a.verdict === "match"
              ? { raw: null, text: "✓", sub: `n=${a.n}`, tone: "good" as const }
              : { raw: null, text: `${a.deltaPts > 0 ? "+" : ""}${a.deltaPts.toFixed(1)}pts`, sub: `n=${a.n}`, tone: "warn" as const };
          },
        },
      ],
    },
    {
      name: "What you get back",
      rows: [
        {
          label: "Value · typical",
          sub: "median pull, per $1",
          cell: (p) => {
            const m = leadMedian(p);
            return m
              ? { raw: m.value, text: m.value.toFixed(2), unit: "×", basis: "realized", n: m.n }
              : { raw: null, text: "—" };
          },
        },
        {
          label: "Value · mean",
          sub: "avg, jackpot-skewed",
          cell: (p) => {
            const e = leadEv(p);
            return e
              ? { raw: e.value, text: e.value.toFixed(2), unit: "×", basis: e.basis, n: e.n }
              : { raw: null, text: "—" };
          },
        },
        {
          label: "Instant buyback",
          sub: "cash out now",
          cell: (p) =>
            p.buybackPct != null
              ? { raw: p.buybackPct, text: String(Math.round(p.buybackPct * 100)), unit: "%", basis: p.buybackBasis }
              : { raw: null, text: "—" },
        },
      ],
    },
    {
      name: norm === "dollar" ? "Ceiling · per $1 spent" : "Ceiling · absolute",
      rows: [
        {
          label: "Top hit",
          sub: norm === "dollar" ? "pool ceiling × spend" : "best card in pool",
          cell: (p) => {
            const v = p.topHitAvailableUsd;
            if (v == null) return { raw: null, text: "—", sub: "no published pool" };
            return norm === "dollar"
              ? { raw: v / p.priceUsd, text: String(Math.round(v / p.priceUsd)), unit: "×", basis: "stated" }
              : { raw: v, text: formatCompactUsd(v), basis: "stated" };
          },
        },
        {
          label: "Biggest pulled",
          sub: norm === "dollar" ? "× spend · so far" : "so far",
          cell: (p) => {
            const v = p.topHitRealizedUsd;
            if (v == null) return { raw: null, text: "—" };
            return norm === "dollar"
              ? { raw: v / p.priceUsd, text: (v / p.priceUsd).toFixed(1), unit: "×", basis: "realized", n: p.realizedN }
              : { raw: v, text: formatCompactUsd(v), basis: "realized", n: p.realizedN };
          },
        },
      ],
    },
    {
      name: "The pool",
      rows: [
        {
          label: "Prizes in pool",
          sub: "named hits",
          cell: (p) => (p.poolDepth != null ? { raw: p.poolDepth, text: formatInt(p.poolDepth) } : { raw: null, text: "—" }),
        },
        {
          label: "In stock",
          sub: "pulls remaining",
          cell: (p) =>
            p.stockCount != null ? { raw: p.stockCount, text: formatInt(p.stockCount) } : { raw: null, text: "—" },
        },
      ],
    },
    {
      name: "Activity",
      rows: [
        {
          label: "Opened · 24h",
          sub: "liquidity",
          cell: (p) =>
            p.pulls24h != null
              ? { raw: p.pulls24h, text: `${p.pulls24hEstimated ? "~" : ""}${formatInt(p.pulls24h)}` }
              : { raw: null, text: "—" },
        },
        {
          label: "Sample size",
          sub: "pulls measured",
          flag: false,
          cell: (p) => (p.realizedN != null ? { raw: p.realizedN, text: `n=${formatInt(p.realizedN)}` } : { raw: null, text: "—" }),
        },
      ],
    },
    { name: "Odds breakdown · measured", rows: BAND_LABELS.map(band) },
  ];
}

function CompareOverlay({
  packs,
  all,
  norm,
  onNorm,
  onReorder,
  onRemove,
  onAdd,
  onClose,
}: {
  packs: GachaPack[];
  all: GachaPack[];
  norm: "abs" | "dollar";
  onNorm: (n: "abs" | "dollar") => void;
  onReorder: (i: number, j: number) => void;
  onRemove: (id: string) => void;
  onAdd: (id: string) => void;
  onClose: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const groups = useMemo(() => cmpGroups(norm), [norm]);
  const last = packs.length - 1;
  const available = useMemo(() => {
    const pinnedIds = new Set(packs.map((p) => p.id));
    return all.filter((p) => !pinnedIds.has(p.id));
  }, [all, packs]);

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[3px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Compare"
        data-compare-modal
        onMouseDown={(e) => {
          if (pickerOpen && !(e.target as HTMLElement).closest("[data-picker]")) setPickerOpen(false);
        }}
        className="fixed inset-0 z-[61] flex flex-col overflow-hidden border border-line-2 bg-bg shadow-[0_30px_80px_rgba(0,0,0,.6)] sm:inset-6 sm:rounded-xl"
      >
        {/* header */}
        <div className="flex flex-none items-center gap-4 border-b border-line bg-bg-1 px-[22px] py-4">
          <div className="text-[15px] font-bold">
            Compare <span className="ml-2 text-[12.5px] font-medium text-ink-3">{packs.length} side by side</span>
          </div>
          <div className="flex-1" />
          <div className="flex gap-[3px] rounded-xl border border-line-2 bg-bg-2 p-[3px]">
            {(
              [
                ["abs", "Absolute $"],
                ["dollar", "Per $1 spent"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => onNorm(k)}
                className={`whitespace-nowrap rounded-xl px-3 py-[7px] text-[11.5px] ${
                  norm === k ? "bg-yellow font-bold text-black" : "font-medium text-ink-3 hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative" data-picker>
            <button
              type="button"
              disabled={packs.length >= MAX_COMPARE}
              onClick={() => setPickerOpen((v) => !v)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-2 bg-bg-2 px-3.5 text-[12.5px] font-semibold text-ink hover:border-yellow hover:text-yellow disabled:opacity-40 disabled:hover:border-line-2 disabled:hover:text-ink"
            >
              + Add another
            </button>
            {pickerOpen && (
              <div className="absolute right-0 top-11 z-[70] max-h-[62vh] w-[300px] overflow-y-auto rounded-xl border border-line-2 bg-bg-2 p-2 shadow-[0_22px_50px_rgba(0,0,0,.6)]">
                {packs.length >= MAX_COMPARE ? (
                  <div className="px-3 py-4 text-center text-[12px] text-ink-4">
                    Max {MAX_COMPARE}. Remove one to add another.
                  </div>
                ) : (
                  tabsFor(available.map((p) => ({ key: listTabOf(p), label: p.categoryLabel }))).map((t) => (
                    <div key={t.key}>
                      <div className="px-2.5 pb-[5px] pt-2.5 text-[10px] uppercase tracking-[0.12em] text-ink-4">
                        {t.label}
                      </div>
                      {available
                        .filter((p) => listTabOf(p) === t.key)
                        .sort((a, b) => a.priceUsd - b.priceUsd)
                        .map((p) => {
                          const o = leadHitOdds(p);
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                onAdd(p.id);
                                setPickerOpen(false);
                              }}
                              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-[9px] text-left text-[12.5px] hover:bg-bg-3"
                            >
                              <Avatar platform={p.platform} short={p.platformShort} size={22} />
                              <span className="flex-1">
                                <span className="block font-semibold">{p.name}</span>
                                <span className="mt-0.5 block text-[10.5px] text-ink-4">
                                  {tierLabel(p.priceUsd)}
                                  {` · ${p.platformName}`}
                                </span>
                              </span>
                              <span className="font-bold text-yellow">{o ? pct(o.value, 0) : "—"}</span>
                            </button>
                          );
                        })}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-xl border border-line-2 bg-bg-2 text-ink-2 hover:border-ink-4 hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* table */}
        <div className="flex-1 overflow-auto">
          <table className="w-max min-w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <td className="sticky left-0 top-0 z-[5] min-w-[178px] border-r border-line bg-bg" />
                {packs.map((p, i) => (
                  <th key={p.id} className="sticky top-0 z-[4] bg-bg-1 p-0 align-bottom font-normal">
                    <div className="relative w-[206px] border-b border-l border-b-line-2 border-l-line px-[18px] pb-3.5 pt-4 text-left">
                      <div className="absolute right-2.5 top-[9px] flex gap-[3px]">
                        <button
                          type="button"
                          disabled={i === 0}
                          onClick={() => onReorder(i, i - 1)}
                          title="Move left"
                          className="grid h-[21px] w-[21px] place-items-center rounded-md border border-line bg-bg-2 text-[11px] text-ink-4 hover:border-line-2 hover:text-ink disabled:pointer-events-none disabled:opacity-25"
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          disabled={i === last}
                          onClick={() => onReorder(i, i + 1)}
                          title="Move right"
                          className="grid h-[21px] w-[21px] place-items-center rounded-md border border-line bg-bg-2 text-[11px] text-ink-4 hover:border-line-2 hover:text-ink disabled:pointer-events-none disabled:opacity-25"
                        >
                          ›
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemove(p.id)}
                          title="Remove"
                          className="grid h-[21px] w-[21px] place-items-center rounded-md border border-line bg-bg-2 text-[11px] text-ink-4 hover:border-red hover:text-red"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="flex items-center gap-[11px]">
                        <Avatar platform={p.platform} short={p.platformShort} size={30} />
                        <div>
                          <div className="text-[14.5px] font-bold">{p.name}</div>
                          <div className="mt-[3px] text-[10.5px] text-ink-3">{p.chain}</div>
                        </div>
                      </div>
                      <div className="mt-[13px] text-[11px] text-ink-3">
                        {tierLabel(p.priceUsd)}
                        {` · ${p.categoryLabel}`}
                        <b className="mt-[3px] block text-[14px] font-bold tracking-[-0.01em] text-yellow tabular">
                          {chaseUsd(p) != null ? formatCompactUsd(chaseUsd(p)!) : "—"}
                        </b>
                        {(p.topHitsAvailable[0]?.name ?? p.topHitRealized?.name) && (
                          <span className="mt-[3px] block max-w-[170px] overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-ink-4">
                            {p.topHitsAvailable[0]?.name ?? p.topHitRealized?.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <CmpGroupRows key={g.name} group={g} packs={packs} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function CmpGroupRows({ group, packs }: { group: CmpGroup; packs: GachaPack[] }) {
  // Real data is sparse where the prototype's synthetic feed wasn't — a row
  // where EVERY pack is "—" says nothing; drop it (and the group when empty).
  // Presence = a magnitude OR any non-dash text (verdict cells carry raw:null).
  const rows = group.rows.filter((row) =>
    packs.some((p) => {
      const c = row.cell(p);
      return c.raw != null || c.text !== "—";
    }),
  );
  if (rows.length === 0) return null;
  return (
    <>
      <tr>
        <td className="sticky left-0 z-[3] border-r border-line bg-bg px-[18px] pb-[7px] pl-6 pt-[18px]">
          <span className="text-[10px] uppercase tracking-[0.14em] text-ink-4">{group.name}</span>
        </td>
        {packs.map((p) => (
          <td key={p.id} className="border-l border-transparent" />
        ))}
      </tr>
      {rows.map((row) => {
        const cells = packs.map((p) => row.cell(p));
        const raws = cells.map((c) => c.raw).filter((v): v is number => v != null);
        const mx = raws.length ? Math.max(...raws) : 0;
        const differ = new Set(raws.map((v) => +v.toFixed(4))).size > 1;
        return (
          <tr key={row.label} className="group/r">
            <td className="sticky left-0 z-[3] min-w-[178px] whitespace-nowrap border-r border-line bg-bg px-[18px] py-3 pl-6 group-hover/r:bg-bg-1">
              <div className="text-[12.5px] font-medium text-ink">{row.label}</div>
              {row.sub && <div className="mt-0.5 text-[10.5px] text-ink-4">{row.sub}</div>}
            </td>
            {packs.map((p, i) => {
              const c = cells[i];
              const isWin = differ && row.flag !== false && c.raw != null && c.raw === mx;
              const frac = c.raw != null && mx > 0 ? Math.max(0.04, c.raw / mx) : 0;
              return (
                <td
                  key={p.id}
                  className="border-b border-l border-line px-[18px] pb-[13px] pt-[11px] align-middle group-hover/r:bg-bg-1"
                >
                  <div className="flex items-baseline gap-[7px]">
                    <span className={`text-[15px] font-bold tracking-[-0.01em] tabular ${isWin ? "text-yellow" : c.tone === "good" ? "text-green" : c.tone === "warn" ? "text-amber" : c.raw == null ? "text-ink-4" : "text-ink"}`}>
                      {c.text}
                      {c.unit && <span className="ml-px text-[11px] font-medium text-ink-3">{c.unit}</span>}
                    </span>
                    {isWin && (
                      <span className="inline-block h-1.5 w-1.5 rounded-none bg-yellow shadow-[0_0_6px_var(--color-yellow)]" />
                    )}
                    {c.basis && (
                      <span className="self-center">
                        <Dot basis={c.basis} n={c.n} />
                      </span>
                    )}
                    {c.sub && <span className="ml-auto text-[10.5px] text-ink-4">{c.sub}</span>}
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-sm bg-bg-3">
                    {c.raw != null && (
                      <i
                        className={`block h-full rounded-sm transition-[width] duration-300 ${isWin ? "bg-yellow" : "bg-ink-3"}`}
                        style={{ width: `${Math.round(frac * 100)}%` }}
                      />
                    )}
                  </div>
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
