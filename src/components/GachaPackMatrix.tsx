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

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

/* ───────────────────────── meta ───────────────────────── */

const PLATFORM_ORDER = ["collector-crypt", "phygitals", "beezie"];
const PLATFORM_COLOR: Record<string, string> = {
  "collector-crypt": "#2bd6a0",
  phygitals: "#ffd23d",
  beezie: "#5b9bff",
};
type Tab = { key: string; label: string };
const TABS: Tab[] = [
  { key: "pokemon", label: "Pokémon" },
  { key: "one_piece", label: "One Piece" },
  { key: "sports", label: "Sports" },
  { key: "mixed", label: "Mixed" },
];
/** Which tab a pack belongs to — pop-culture & no-single-IP packs share "Mixed". */
function tabOf(p: GachaPack): string {
  if (p.category === "pokemon" || p.category === "one_piece" || p.category === "sports") return p.category;
  return "mixed";
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
  return b === "realized" ? "#6cf48a" : b === "stated" ? "#8a8a8a" : "#5a5a5a";
}
function basisTitle(b: MetricBasis, n?: number | null): string {
  if (b === "realized") return `Measured on-chain${n != null ? ` · ${n} pull${n === 1 ? "" : "s"}` : ""}`;
  if (b === "stated") return "Platform-advertised — vendor claim, unverified";
  if (b === "assumed") return "Unverified estimate, no source";
  return "Platform-wide only — not specific to this pack";
}
function Dot({ basis, n }: { basis: MetricBasis; n?: number | null }) {
  return (
    <span
      title={basisTitle(basis, n)}
      className="inline-block h-[5px] w-[5px] shrink-0 rounded-none"
      style={{
        background: basis === "assumed" ? "transparent" : basisColor(basis),
        border: basis === "assumed" ? "1px dashed #6a6a6a" : undefined,
      }}
    />
  );
}
function Avatar({ platform, short, size }: { platform: string; short: string; size: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-none font-bold text-black"
      style={{ background: PLATFORM_COLOR[platform] ?? "#888", width: size, height: size, fontSize: size * 0.34 }}
    >
      {short}
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

export function GachaPackMatrix({ packs, prizes }: { packs: GachaPack[]; prizes: GachaPrize[] }) {
  // CC Dune-fallback shells aren't pack-attributable — the matrix is pack-grain.
  const usable = useMemo(() => packs.filter((p) => !p.notDirectlyComparable && p.priceUsd > 0), [packs]);
  const byId = useMemo(() => new Map(usable.map((p) => [p.id, p])), [usable]);

  const tabs = useMemo(() => TABS.filter((t) => usable.some((p) => tabOf(p) === t.key)), [usable]);
  const [tab, setTab] = useState<string>("pokemon");
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

  const togglePin = useCallback((id: string) => {
    setPins((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      const next = [...cur, id];
      return next.length > MAX_COMPARE ? next.slice(next.length - MAX_COMPARE) : next; // FIFO
    });
  }, []);

  // matrix model for the current tab: platform rows × price columns, cells
  // hold ALL packs at that (platform, price) — lead pack shown, rest stepped.
  // Mixed-pool packs (no single game, e.g. Beezie's TCG claws) appear in EVERY
  // IP tab — they're a real alternative at that price — flagged "mixed pool"
  // since their pool (and thus odds) isn't specific to the tab's game.
  const model = useMemo(() => {
    const inTab = usable.filter((p) => tabOf(p) === tab || (tab !== "mixed" && p.category === null));
    const prices = [...new Set(inTab.map((p) => p.priceUsd))].sort((a, b) => a - b);
    const platforms = PLATFORM_ORDER.filter((key) => inTab.some((p) => p.platform === key)).map((key) => {
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
      const mixedPool = tab !== "mixed" && mine.every((p) => p.category === null);
      return { key, name: sample.platformName, short: sample.platformShort, chain: sample.chain, cells, mixedPool };
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
  }, [usable, tab]);

  // drawer stepping order: every pack at the SAME price in the open pack's own
  // game (+ mixed pools) — independent of the matrix tab, so packs opened from
  // the prize grid still step sensibly.
  const drawerPack = drawerId ? byId.get(drawerId) ?? null : null;
  const siblings = useMemo(() => {
    if (!drawerPack) return [];
    const dTab = tabOf(drawerPack);
    return usable
      .filter(
        (p) => p.priceUsd === drawerPack.priceUsd && (tabOf(p) === dTab || p.category === null),
      )
      .sort(
        (a, b) =>
          PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform) ||
          (leadHitOdds(b)?.value ?? -1) - (leadHitOdds(a)?.value ?? -1),
      )
      .map((p) => p.id);
  }, [usable, drawerPack]);

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

  return (
    <section className="mt-10">
      {/* One shared Section frame (D1); the IP tabs ride the header's right slot. */}
      <Section
        title="Compare packs across platforms"
        subtitle="Compare hit odds, top prizes, and expected returns by price tier."
        right={
          <div className="flex gap-1 rounded-xl border border-line bg-bg-2 p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`rounded-xl px-[15px] py-2 text-[13px] transition-colors ${
                  tab === t.key ? "bg-yellow font-bold text-black" : "font-medium text-ink-3 hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      >
      {/* matrix — pinned platform rail + scrollable tier grid. Uniform fixed
          row heights keep the two panes aligned; the scrollbar is hidden and a
          right-edge fade signals the overflow instead. The rail + fade masks
          match the Section card surface (bg-1). */}
      <div className="flex pt-1">
        <div className="z-[1] shrink-0 bg-bg-1 pr-4">
          <div className="flex h-[34px] items-end pb-2">
            <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-4">Platform</span>
          </div>
          {model.platforms.map((pl) => (
            <div key={pl.key} className="mt-[7px] flex h-[92px] items-center gap-[11px]">
              <Avatar platform={pl.key} short={pl.short} size={32} />
              <div>
                <div className="whitespace-nowrap text-[14px] font-bold">{pl.name}</div>
                <div className="mt-[3px] flex items-center gap-1.5 whitespace-nowrap text-[10px] text-ink-3">
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
          <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                        onOpen={() => setDrawerId(lead.id)}
                        onPin={() => togglePin(lead.id)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="pointer-events-none absolute right-0 top-0 h-full w-10 bg-gradient-to-l from-bg-1 to-transparent" />
        </div>
      </div>
      </Section>

      <PrizeFinder prizes={prizes} packsById={byId} onOpenPack={(id) => setDrawerId(id)} />

      {/* tray */}
      <div
        className={`fixed bottom-[22px] left-1/2 z-[45] flex max-w-[94vw] items-center gap-3.5 rounded-2xl border border-line-2 bg-bg-2 py-3 pl-[18px] pr-3.5 shadow-[0_18px_50px_rgba(0,0,0,.55)] transition-transform duration-300 ease-[cubic-bezier(.22,1,.36,1)] ${
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
function PrizeFinder({
  prizes,
  packsById,
  onOpenPack,
}: {
  prizes: GachaPrize[];
  packsById: Map<string, GachaPack>;
  onOpenPack: (packId: string) => void;
}) {
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

  const platforms = useMemo(
    () => [...new Set(prizes.map((p) => p.platform))].sort(
      (a, b) => PLATFORM_ORDER.indexOf(a) - PLATFORM_ORDER.indexOf(b),
    ),
    [prizes],
  );
  const games = useMemo(() => {
    const present = new Set(prizes.map((p) => p.category ?? "mixed"));
    return TABS.filter((t) => present.has(t.key));
  }, [prizes]);

  // One card can sit in several pools (and at several prices) — group by the
  // card itself so the grid shows ONE slab with all the packs that pay it.
  // Pulled examples never merge with available pool entries.
  const groupKey = (p: GachaPrize) =>
    `${p.pulled ? "pulled" : "avail"}:${p.name ? p.name.toLowerCase().replace(/\s+/g, " ").trim() : `id:${p.id}`}:${p.grade ?? ""}`;

  const totalCards = useMemo(() => new Set(prizes.map(groupKey)).size, [prizes]);

  const groups = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = prizes.filter((p) => {
      if (game !== "all" && (p.category ?? "mixed") !== game) return false;
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
  const gameLabel = game === "all" ? "All" : TABS.find((t) => t.key === game)?.label ?? game;
  const platformLabel =
    platform === "all" ? "All" : platform === "phygitals" ? "Phygitals" : platform === "beezie" ? "Beezie" : "Collector Crypt";
  const sortLabel = sort === "value" ? "Top value" : sort === "cheapest" ? "Cheapest pack" : "A–Z";

  if (prizes.length === 0) return null;

  return (
    <Section
      title={
        <>
          Find your <em className="not-italic text-yellow">chase</em>
        </>
      }
      subtitle="Every advertised pool prize — follow a card to the pack that pays it"
      right={
        <span className="text-[11px] tabular text-ink-3">
          {groups.length === totalCards
            ? `${formatInt(totalCards)} cards in pools`
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
          label="Platform"
          value={platformLabel}
          open={openMenu === "platform"}
          onToggle={() => setOpenMenu((m) => (m === "platform" ? null : "platform"))}
          options={[
            { key: "all", label: "All" },
            ...platforms.map((key) => ({
              key,
              label: key === "phygitals" ? "Phygitals" : key === "beezie" ? "Beezie" : "Collector Crypt",
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
            { key: "cheapest", label: "Cheapest pack" },
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

      {/* grid */}
      {shown.length > 0 ? (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {shown.map((g) => (
            <PrizeCard key={g.key} group={g} onExpand={() => setExpanded(g)} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-line/70 px-6 py-12 text-center text-[12.5px] leading-relaxed text-ink-3">
          No prize matches{q ? ` “${q}”` : " these filters"} — try fewer words.
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
    <div className="relative shrink-0" data-pill>
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
          {!multi && prize.tier && (
            <span className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.06em] text-ink-2">
              {prize.tier}
            </span>
          )}
          {prize.pulled && (
            <span
              title="Already won — an example of what this machine pays (Collector Crypt doesn't publish its pools)"
              className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.06em] text-ink-3"
            >
              Pulled
            </span>
          )}
          {/* explicit, discoverable CTA — click expands the card + its packs */}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/85 via-black/55 to-transparent pb-2 pt-7 text-[11px] font-bold text-yellow opacity-0 transition-opacity group-hover:opacity-100">
            {multi ? `Win it · ${group.packs.length} packs` : "Win this card"} <span aria-hidden>→</span>
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
                <span className="min-w-0 truncate">{group.packs.length} packs</span>
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
      label: "Pack price",
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
          <span className="text-ink-3">pulled example</span>
        ) : (
          <span className="text-ink-3">chase pool</span>
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
            <span className="ml-1 text-[10px] text-ink-4">/pack</span>
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
      label: "Pack's top hit",
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
          <span className="font-semibold text-[#ffd23d]">{`⚠ ${a.deltaPts > 0 ? "+" : ""}${a.deltaPts.toFixed(1)}pts`}</span>
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
                {prize.pulled ? "An example this machine paid" : "Win this card"}
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
                  <>Collector Crypt doesn&apos;t publish its pools — this is a real pull from the machine below.</>
                ) : multi ? (
                  <>
                    In <span className="font-semibold text-ink">{cols.length} packs</span> — compare where to open:
                  </>
                ) : (
                  <>Win it by opening this pack:</>
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
                      <div className="text-[10px] text-ink-4">{platformName(c.prize.platform)}</div>
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
                    Open full pack →
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
                style={{ width: `${Math.max(2, Math.min(100, b.pct * 100))}%`, background: b.hit ? "var(--color-yellow)" : "#3a3a3a" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function platformName(key: string): string {
  return key === "phygitals" ? "Phygitals" : key === "beezie" ? "Beezie" : key === "collector-crypt" ? "Collector Crypt" : key;
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
  onOpen,
  onPin,
}: {
  pack: GachaPack;
  extra: number;
  best: boolean;
  pinned: boolean;
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
      title={`${pack.name} · ${pack.platformName}${extra > 0 ? ` (+${extra} more at this price — open to step through)` : ""}`}
      className={`group relative h-[92px] w-[140px] shrink-0 cursor-pointer rounded-xl border px-[13px] py-[11px] text-left font-mono transition-[border-color,transform,background] duration-100 hover:-translate-y-0.5 ${
        pinned ? "border-yellow" : best ? "border-yellow" : "border-line bg-bg-1 hover:border-line-2"
      }`}
      style={best ? { background: "linear-gradient(180deg, rgba(243,255,66,.10), transparent 78%)" } : undefined}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPin();
        }}
        title={pinned ? "Remove from compare" : "Add to compare"}
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
      <div className="mt-1 text-[8.5px] uppercase tracking-[0.08em] text-ink-4">hit odds</div>
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
      style={cellBest ? { background: "linear-gradient(180deg, rgba(243,255,66,.10), transparent 78%)" } : undefined}
    >
      <div className="mb-1 px-1 text-[8.5px] uppercase tracking-[0.08em] text-ink-4">{packs.length} packs</div>
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
      <span className={`font-semibold ${off ? "text-[#ffd23d]" : "text-green"}`}>
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
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px] transition-opacity duration-250 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        ref={scrollRef}
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-50 h-screen w-[540px] max-w-[94vw] overflow-y-auto border-l border-line-2 bg-bg-1 transition-transform duration-300 ease-[cubic-bezier(.22,1,.36,1)] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* sticky header */}
        <div className="sticky top-0 z-[2] flex items-center gap-3 border-b border-line bg-bg-1 px-6 py-[18px]">
          <div className="flex items-center gap-[11px]">
            <Avatar platform={d.platform} short={d.platformShort} size={34} />
            <div>
              <div className="text-[15px] font-bold">{d.name}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">
                {tierLabel(d.priceUsd)}
                {` · ${d.categoryLabel} · ${d.platformName}`}
              </div>
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
                        style={{ background: b.hit ? "#ffd23d" : "var(--color-ink-4)" }}
                      />
                      {b.label}
                    </span>
                    <span className="h-[5px] overflow-hidden rounded-md bg-bg-3">
                      <i
                        className="block h-full"
                        style={{ width: `${Math.min(100, b.pct * 100)}%`, background: b.hit ? "#ffd23d" : "var(--color-ink-4)" }}
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
            <KV
              k="Mean · net of buyback"
              v={netEv(d) != null ? `${netEv(d)!.toFixed(2)}×` : "—"}
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
            <h4 className="mb-3.5 text-[10.5px] font-medium uppercase tracking-[0.13em] text-ink-3">This pack</h4>
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
        onMouseDown={(e) => {
          if (pickerOpen && !(e.target as HTMLElement).closest("[data-picker]")) setPickerOpen(false);
        }}
        className="fixed inset-0 z-[61] flex flex-col overflow-hidden border border-line-2 bg-bg shadow-[0_30px_80px_rgba(0,0,0,.6)] sm:inset-6 sm:rounded-xl"
      >
        {/* header */}
        <div className="flex flex-none items-center gap-4 border-b border-line bg-bg-1 px-[22px] py-4">
          <div className="text-[15px] font-bold">
            Compare <span className="ml-2 text-[12.5px] font-medium text-ink-3">{packs.length} packs side by side</span>
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
                    Max {MAX_COMPARE} packs. Remove one to add another.
                  </div>
                ) : (
                  TABS.filter((t) => available.some((p) => tabOf(p) === t.key)).map((t) => (
                    <div key={t.key}>
                      <div className="px-2.5 pb-[5px] pt-2.5 text-[10px] uppercase tracking-[0.12em] text-ink-4">
                        {t.label}
                      </div>
                      {available
                        .filter((p) => tabOf(p) === t.key)
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
                    <span className={`text-[15px] font-bold tracking-[-0.01em] tabular ${isWin ? "text-yellow" : c.tone === "good" ? "text-green" : c.tone === "warn" ? "text-[#ffd23d]" : c.raw == null ? "text-ink-4" : "text-ink"}`}>
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
