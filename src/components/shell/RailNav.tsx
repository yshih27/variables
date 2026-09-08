"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RailModel, RailNode } from "@/lib/types";
import { GACHA_ENABLED } from "@/lib/flags";
import { RailSpark } from "./RailSpark";
import { RailFlyout, useFlyout } from "./RailFlyout";
import { RailToggle } from "./RailToggle";
import { RAIL_OPEN_KEY } from "./railPref";
import { useRailPref } from "./useRailPref";

/**
 * The persistent left rail (SHELL_V2 S1) — the taxonomy, with a live micro-spark
 * and a delta on every node. North-star Move 1: this is what replaces header-tab
 * navigation on desktop.
 *
 * The MODEL is server-built and cached (`buildRailModel`), so the rail is never
 * a skeleton on a warm path — it arrives in the layout's HTML. This client leaf
 * exists only for the three things that genuinely need the browser: the active
 * path, the expand/collapse state, and the stored open/icons preference.
 *
 * ⚠️ Width is NOT set here. The grid column is `--shell-rail-w`, driven by the
 * viewport and by `data-rail` on <html> (stamped pre-hydration, see railPref).
 * Setting it in React too would fight the pre-paint value and reintroduce the
 * flash that script exists to prevent.
 */

type Props = { model: RailModel };

/** Static tail nodes — no series behind them, so no spark, by construction. */
const TAIL: { key: string; name: string; short: string; href: string; gated?: boolean }[] = [
  { key: "report", name: "Report", short: "RPT", href: "/report" },
  { key: "watchlist", name: "Watchlist", short: "★", href: "/watchlist" },
  { key: "gacha", name: "Gacha", short: "GCH", href: "/gacha", gated: true },
  { key: "status", name: "Status", short: "SYS", href: "/status" },
];

/**
 * Is this node the one the current path is inside?
 *
 * Prefix-aware on purpose: `/platform/beezie/sales` must light Platforms › Beezie,
 * not fall through to nothing. Guarded with a "/" boundary so `/ip/pokemon` can't
 * light a hypothetical `/ip/poke`.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function RailNav({ model }: Props) {
  const pathname = usePathname() ?? "/";
  const [pref] = useRailPref();
  /** EXPLICIT open/closed choices only, persisted per category. Everything else
   *  falls through to the derivation below, so the branch you are standing in is
   *  open without an effect having to push it open after the fact. */
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const navRef = useRef<HTMLElement | null>(null);
  const flyout = useFlyout();

  // Restore the per-category open map AFTER mount (storage during render is a
  // hydration mismatch). Until it lands, the derivation below holds: the active
  // category open, the rest closed — which is also the default the brief asks for.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(RAIL_OPEN_KEY);
    } catch {
      /* blocked storage — the rail just won't remember */
    }
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const clean: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "boolean") clean[k] = v;
      }
      if (Object.keys(clean).length === 0) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverride(clean);
    } catch {
      /* malformed value — fall through to the derived default */
    }
  }, []);

  const persistOpen = useCallback((next: Record<string, boolean>) => {
    try {
      localStorage.setItem(RAIL_OPEN_KEY, JSON.stringify(next));
    } catch {
      /* blocked storage */
    }
  }, []);

  // The branch you are standing in is open BY DERIVATION, not by an effect that
  // pushes it open after the first paint — a deep link into /ip/pokemon must not
  // render a collapsed TCG and then expand it.
  const activeCategory = model.categories.find((c) => c.ips.some((ip) => isActive(pathname, ip.href)));
  const isOpen = (key: string) => override[key] ?? key === activeCategory?.key;
  const setOpen = (key: string, open: boolean) =>
    setOverride((o) => {
      const next = { ...o, [key]: open };
      persistOpen(next);
      return next;
    });
  const toggle = (key: string) => setOpen(key, !isOpen(key));

  // Scroll the active node into view on navigation. Found in the DOM by its own
  // `aria-current` rather than a ref threaded through render — one source of
  // truth for "which node is active", and it is the accessible one.
  // `block: "nearest"` so an already-visible node doesn't jump on every route change.
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [pathname]);

  const nodeProps = (href: string) => {
    const active = isActive(pathname, href);
    return { "aria-current": active ? ("page" as const) : undefined, active };
  };

  /** Flyouts are REAL DOM with links in it, so they are gated on the pref rather
   *  than hidden by CSS — `display:none` would leave those links tabbable at 240px. */
  const collapsed = pref === "icons";
  const flyoutProps = (node: RailNode, ips?: RailNode[]) =>
    collapsed
      ? {
          onMouseEnter: (e: React.MouseEvent<HTMLElement>) => flyout.open(node.key, e.currentTarget),
          onMouseLeave: () => flyout.close(node.key),
          onFocus: (e: React.FocusEvent<HTMLElement>) =>
            flyout.open(node.key, e.currentTarget.closest<HTMLElement>("[data-rail-node]")),
          flyout:
            flyout.openKey === node.key ? (
              <RailFlyout
                node={node}
                ips={ips}
                anchor={flyout.anchor}
                onClose={() => flyout.close(node.key)}
              />
            ) : null,
        }
      : {};

  return (
    <nav
      ref={navRef}
      aria-label="Market taxonomy"
      /* Sticky under the top bar with its OWN scroll — the brief's "rail scroll is
         independent of content scroll". Hidden below lg, where BottomTabs takes over. */
      onMouseLeave={flyout.closeAll}
      /* `rail-shell` carries the hairline affordance: the right border brightens
         on hover of the RAIL, so a collapsed column of codes reads as an edge you
         can act on. overflow-visible in icons mode (see globals.css) so a flyout
         can escape the 56px column. */
      className="rail-shell scroll-y sticky top-[var(--shell-chrome-h,var(--shell-topbar-h))] hidden h-[calc(100dvh-var(--shell-chrome-h,var(--shell-topbar-h)))] min-h-0 flex-col overflow-y-auto border-r border-line/70 transition-colors lg:flex"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-px py-2">
        <RailLink node={model.market} {...nodeProps(model.market.href)} {...flyoutProps(model.market)} />
        {/* Stats sits under Market: it is the same market, stated for citation.
            No spark — it is a page, not a series. */}
        <RailLink
          node={{ key: "stats", name: "Stats", short: "STA", href: "/stats", spark: null, deltaPct: null, deltaWindow: "24h" }}
          nested
          noStats
          {...nodeProps("/stats")}
        />

        <RailSectionLabel>Categories</RailSectionLabel>
        {model.categories.map((c) => {
          const open = isOpen(c.key);
          return (
            <div key={c.key}>
              <RailBranch
                node={c}
                open={open}
                count={c.ips.length}
                onToggle={() => toggle(c.key)}
                onSetOpen={(v) => setOpen(c.key, v)}
                {...flyoutProps(c, c.ips)}
              />
              {open &&
                !collapsed &&
                c.ips.map((ip) => <RailLink key={ip.key} node={ip} nested {...nodeProps(ip.href)} />)}
            </div>
          );
        })}

        {model.platforms.length > 0 && <RailSectionLabel>Platforms</RailSectionLabel>}
        {model.platforms.map((p) => (
          <RailLink key={p.key} node={p} {...nodeProps(p.href)} {...flyoutProps(p)} />
        ))}

        <RailSectionLabel>More</RailSectionLabel>
        {TAIL.filter((t) => !t.gated || GACHA_ENABLED).map((t) => (
          <RailLink
            key={t.key}
            node={{ key: t.key, name: t.name, short: t.short, href: t.href, spark: null, deltaPct: null, deltaWindow: "24h" }}
            noStats
            {...nodeProps(t.href)}
          />
        ))}
      </div>

      {/* Duplicate of the top control, for a long rail where the brand-bar chevron
          has scrolled out of reach. Only where there is a choice: below 1280 the
          rail is iconised by the viewport, so a toggle there would be a lie. */}
      <div className="sticky bottom-0 hidden border-t border-line/70 bg-bg/90 p-2 backdrop-blur-xl xl:block">
        <RailToggle variant="foot" />
      </div>
    </nav>
  );
}

function RailSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rail-label mt-3 px-3 pb-1 pt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-4">
      {children}
    </div>
  );
}

/** Shared by both row kinds: the hover/focus wiring that opens a flyout in the
 *  collapsed rail, plus the panel itself. Empty at 240px, where the row already
 *  shows everything the flyout would. */
type FlyoutProps = {
  onMouseEnter?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave?: () => void;
  onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
  flyout?: React.ReactNode;
};

/**
 * One navigable node. In the 56px icon rail everything but `short` is hidden by
 * the `.rail-label` / `.rail-stats` classes (CSS, driven by the same
 * `--shell-rail-w` the grid uses) — one width rule, not a second React branch
 * that could disagree with the pre-paint value. What the reader loses to that
 * width, the flyout gives back.
 */
function RailLink({
  node,
  nested,
  noStats,
  active,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  flyout,
  ...rest
}: {
  node: RailNode;
  nested?: boolean;
  noStats?: boolean;
  active: boolean;
  "aria-current"?: "page";
} & FlyoutProps) {
  return (
    <div data-rail-node className="relative" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <Link
        {...rest}
        href={node.href}
        title={node.name}
        onFocus={onFocus}
        className={`group mx-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60 ${
          active ? "bg-bg-2 text-ink" : "text-ink-2 hover:bg-bg-1 hover:text-ink"
        } ${nested ? "rail-nested" : ""}`}
      >
        <span
          aria-hidden
          className={`rail-code w-9 shrink-0 text-center font-mono text-[9.5px] uppercase tracking-[0.04em] ${
            active ? "text-yellow" : "text-ink-4"
          }`}
        >
          {node.short ?? node.name.slice(0, 3).toUpperCase()}
        </span>
        <span className="rail-label min-w-0 flex-1 truncate">{node.name}</span>
        {!noStats && (
          <span className="rail-stats">
            <RailSpark node={node} />
          </span>
        )}
      </Link>
      {flyout}
    </div>
  );
}

/**
 * A category row (polish r1, item 4).
 *
 * ⚠️ THE ROW IS THE TOGGLE, NOT A LINK. It used to be a link plus an 11px `+` at
 * the far right — a disclosure nobody could see, on a row that navigated away
 * when you tried to expand it. Now the whole row expands, a chevron at the LEFT
 * says so, and the category PAGE is a deliberate "open →" that appears on hover
 * or focus. A click on the row can no longer navigate by surprise.
 *
 * The link is a SIBLING of the button, never nested inside it: an <a> within a
 * <button> is invalid, and both need to be independently clickable.
 *
 * Keyboard: Enter/Space toggle natively (it is a real button); Right opens and
 * Left closes, the tree-widget convention, so a keyboard user isn't forced to
 * toggle blind.
 */
function RailBranch({
  node,
  open,
  count,
  onToggle,
  onSetOpen,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  flyout,
}: {
  node: RailNode;
  open: boolean;
  count: number;
  onToggle: () => void;
  onSetOpen: (open: boolean) => void;
} & FlyoutProps) {
  return (
    <div data-rail-node className="relative" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <div className="group mx-1 flex items-center rounded-lg transition-colors hover:bg-bg-1">
        <button
          type="button"
          onClick={onToggle}
          onFocus={onFocus}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" && !open) {
              e.preventDefault();
              onSetOpen(true);
            } else if (e.key === "ArrowLeft" && open) {
              e.preventDefault();
              onSetOpen(false);
            }
          }}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${node.name} (${count} IPs)`}
          title={node.name}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-ink-2 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
        >
          {/* Chevron first, so the disclosure is where the eye starts the row. */}
          <span aria-hidden className="rail-chevron shrink-0 text-ink-2" data-open={open ? "" : undefined}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span
            aria-hidden
            className="rail-code w-7 shrink-0 text-center font-mono text-[9.5px] uppercase tracking-[0.04em] text-ink-4"
          >
            {node.short ?? node.name.slice(0, 3).toUpperCase()}
          </span>
          <span className="rail-label min-w-0 flex-1 truncate">{node.name}</span>
          {/* How many IPs are behind the row — the reason to open it. */}
          <span className="rail-label shrink-0 rounded bg-bg-2 px-1 font-mono text-[9.5px] leading-[1.4] text-ink-4">
            {count}
          </span>
        </button>

        {/* The category page, on purpose rather than by accident. It takes the
            stats' slot on hover/focus so the 240px row doesn't grow. */}
        <span className="rail-stats relative mr-1 flex shrink-0 items-center">
          <span className="group-focus-within:invisible group-hover:invisible">
            <RailSpark node={node} />
          </span>
          <Link
            href={node.href}
            className="absolute inset-0 hidden items-center justify-end whitespace-nowrap rounded px-1 text-[11px] text-ink-3 transition-colors hover:text-yellow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60 group-focus-within:flex group-hover:flex"
          >
            open →
          </Link>
        </span>
      </div>
      {flyout}
    </div>
  );
}
