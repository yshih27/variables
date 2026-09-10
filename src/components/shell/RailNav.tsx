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
import { RAIL_CODES } from "@/lib/data/railCode";
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
const TAIL: { key: string; name: string; short: string; railCode: string; href: string; gated?: boolean }[] = [
  { key: "report", name: "Report", short: "RPT", railCode: RAIL_CODES.report, href: "/report" },
  { key: "watchlist", name: "Watchlist", short: "★", railCode: RAIL_CODES.watchlist, href: "/watchlist" },
  { key: "gacha", name: "Gacha", short: "GCH", railCode: RAIL_CODES.gacha, href: "/gacha", gated: true },
  { key: "status", name: "Status", short: "SYS", railCode: RAIL_CODES.status, href: "/status" },
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
  const flyoutProps = (
    node: RailNode,
    ips?: RailNode[],
    groups?: { label: string; items: RailNode[] }[],
  ) =>
    collapsed
      ? {
          onMouseEnter: (e: React.MouseEvent<HTMLElement>) => flyout.open(node.key, e.currentTarget),
          onMouseLeave: () => flyout.close(node.key),
          onFocus: (e: React.FocusEvent<HTMLElement>) =>
            flyout.open(node.key, e.currentTarget.closest<HTMLElement>("[data-rail-node]")),
          /**
           * ⚠️ CLICK OPENS THE PANEL, IT DOES NOT NAVIGATE — for nodes that HAVE a
           * panel worth opening (a category's IP list, a venue's card). The tile
           * still carries its href, so middle-click / open-in-new-tab keep
           * working; a plain click is caught here because the flyout is the only
           * path to the branch at 56px and hover was the only way to reach it.
           * Focus moves into the panel (RailFlyout), Escape brings it back.
           */
          onClick: (e: React.MouseEvent<HTMLElement>) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            flyout.toggle(node.key, e.currentTarget.closest<HTMLElement>("[data-rail-node]"));
          },
          flyout:
            flyout.openKey === node.key ? (
              <RailFlyout
                node={node}
                ips={ips}
                groups={groups}
                anchor={flyout.anchor}
                pinned={flyout.pinned}
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
      <div className={`flex min-h-0 flex-1 flex-col py-2 ${collapsed ? "items-center gap-1.5" : "gap-px"}`}>
        {/* The expand control is a TILE, at the top under the brand mark — where
            a collapsed rail's reader looks first. Only where there is a choice. */}
        {collapsed && (
          /* ⚠️ `hidden xl:contents` — NOT a fragment. Between 1024 and 1279 the rail
             is iconised BY THE VIEWPORT (railPref's RAIL_ICONS_MAX_PX), so there is
             nothing for this control to toggle and r1's rule is that it must not
             render there. `contents` keeps the tile and the rule as direct flex
             children at >=1280, so gating costs no geometry. */
          <div className="hidden xl:contents">
            <RailToggle variant="tile" />
            <RailRule />
          </div>
        )}
        <RailLink node={model.market} collapsed={collapsed} {...nodeProps(model.market.href)} {...flyoutProps(model.market)} />
        {/* Stats sits under Market: it is the same market, stated for citation.
            No spark — it is a page, not a series. */}
        <RailLink
          node={{ key: "stats", name: "Stats", short: "STA", railCode: RAIL_CODES.stats, href: "/stats", spark: null, deltaPct: null, deltaWindow: "24h" }}
          nested
          noStats
          collapsed={collapsed}
          {...nodeProps("/stats")}
        />

        <RailSectionLabel collapsed={collapsed} href="/ips" code={RAIL_CODES.categories} active={pathname === "/ips"}>
          Categories
        </RailSectionLabel>
        {model.categories.map((c) => {
          const open = isOpen(c.key);
          return (
            <div key={c.key}>
              <RailBranch
                node={c}
                open={open}
                count={c.ips.length}
                collapsed={collapsed}
                active={false}
                onToggle={() => toggle(c.key)}
                onSetOpen={(v) => setOpen(c.key, v)}
                {...flyoutProps(c, c.ips, [
                  { label: "Sets", items: c.sets },
                  // ⚠️ LABELLED "market-wide" because a `grade:` entity carries no
                  // IP. Under a category heading, an unqualified "Grades" list
                  // would read as this category's own grade indices.
                  { label: "Grades · market-wide", items: model.grades },
                ])}
              />
              {open &&
                !collapsed &&
                c.ips.map((ip) => <RailLink key={ip.key} node={ip} nested {...nodeProps(ip.href)} />)}
            </div>
          );
        })}

        {model.platforms.length > 0 && (
          <RailSectionLabel collapsed={collapsed} href="/platforms" code={RAIL_CODES.platforms} active={pathname === "/platforms"}>
            Platforms
          </RailSectionLabel>
        )}
        {model.platforms.map((p) => (
          <RailLink key={p.key} node={p} collapsed={collapsed} {...nodeProps(p.href)} {...flyoutProps(p)} />
        ))}
        {/* Economics sits under Platforms because it is a cross-platform read of
            the same venues — not a sixth venue. No spark: it is a page, not a
            series, and a spark here would imply one. */}
        <RailLink
          node={{ key: "economics", name: "Economics", short: "ECO", railCode: RAIL_CODES.economics, href: "/economics", spark: null, deltaPct: null, deltaWindow: "24h" }}
          nested
          noStats
          collapsed={collapsed}
          {...nodeProps("/economics")}
        />

        <RailSectionLabel collapsed={collapsed}>More</RailSectionLabel>
        {TAIL.filter((t) => !t.gated || GACHA_ENABLED).map((t) => (
          <RailLink
            key={t.key}
            node={{ key: t.key, name: t.name, short: t.short, railCode: t.railCode, href: t.href, spark: null, deltaPct: null, deltaWindow: "24h" }}
            noStats
            collapsed={collapsed}
            {...nodeProps(t.href)}
          />
        ))}
      </div>

      {/* Duplicate of the top control, for a long rail where the brand-bar chevron
          has scrolled out of reach. Only where there is a choice: below 1280 the
          rail is iconised by the viewport, so a toggle there would be a lie. */}
      {/* The duplicate, for a rail long enough that the top control has scrolled
          out of reach. Collapsed it is the SAME tile as everything above it, not a
          bare glyph. */}
      <div
        className={`sticky bottom-0 border-t border-line/70 bg-bg/90 backdrop-blur-xl ${
          collapsed ? "hidden justify-center p-1.5 xl:flex" : "hidden p-2 xl:block"
        }`}
      >
        <RailToggle variant={collapsed ? "tile" : "foot"} />
      </div>
    </nav>
  );
}

/**
 * A section break. Expanded it is a label; collapsed it is a 1px rule.
 *
 * ⚠️ WITH `href`, THE LABEL IS A LANDING LINK (nav r3). "Categories" and
 * "Platforms" were text a first-time reader clicked and nothing happened — the
 * only way to /ips was to know a category ROW went there. Now the heading is the
 * link, with the same active state a row gets. Collapsed, the rule is replaced by
 * a tile carrying the section's monogram (`code`) so icons mode keeps the path;
 * a section with no destination ("More") stays a label / a rule.
 */
function RailSectionLabel({
  children,
  collapsed,
  href,
  code,
  active,
}: {
  children: React.ReactNode;
  collapsed?: boolean;
  href?: string;
  /** Two-character monogram for the collapsed tile. Required with `href`. */
  code?: string;
  active?: boolean;
}) {
  if (collapsed) {
    if (!href || !code) return <RailRule />;
    return (
      <>
        <RailRule />
        <RailTile as="link" href={href} code={code} label={String(children)} active={!!active} aria-current={active ? "page" : undefined} />
      </>
    );
  }
  const cls = "rail-label mt-3 block px-3 pb-1 pt-1 text-[10px] font-medium uppercase tracking-[0.12em]";
  if (!href) return <div className={`${cls} text-ink-4`}>{children}</div>;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`${cls} rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60 ${
        active ? "text-ink" : "text-ink-4 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

/**
 * ONE tile. 36×36, packed at a 42px pitch by the 6px column gap around it.
 *
 * ⚠️ THREE STATES, EACH VISIBLY DIFFERENT IN A STILL. Active is a FILLED tile
 * (bg-yellow, bg-coloured monogram) — an outline was indistinguishable from hover
 * in the review screenshot. Hover is bg-bg-3, one step up from the resting
 * bg-bg-2. Focus-visible is the house ring, which sits outside the tile so it
 * never reads as a fourth fill.
 *
 * Radius comes from the theme token (`rounded-lg` = --radius-lg), not a literal —
 * the whole point of the one-knob radius system.
 */
function RailTile({
  as,
  href,
  code,
  label,
  active,
  onClick,
  onLinkClick,
  onFocus,
  ...rest
}: {
  as: "link" | "button";
  href?: string;
  /** Exactly two characters, or the ★ glyph. */
  code: string;
  label: string;
  active: boolean;
  onClick?: () => void;
  /** For the link form: intercept a plain click (the flyout), let modified clicks through. */
  onLinkClick?: (e: React.MouseEvent<HTMLElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
  "aria-current"?: "page";
  "aria-label"?: string;
}) {
  const cls = `flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-[11px] uppercase leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60 ${
    active ? "bg-yellow font-semibold text-bg" : "bg-bg-2 text-ink-2 hover:bg-bg-3 hover:text-ink"
  }`;
  const inner = <span aria-hidden>{code}</span>;
  if (as === "button") {
    return (
      <button type="button" onClick={onClick} onFocus={onFocus} title={label} aria-label={label} className={cls} {...rest}>
        {inner}
      </button>
    );
  }
  return (
    <Link href={href ?? "#"} onFocus={onFocus} onClick={onLinkClick} title={label} aria-label={label} className={cls} {...rest}>
      {inner}
    </Link>
  );
}

/** ⚠️ NO MARGIN OF ITS OWN. The column is a flex stack with a 6px gap, so the
 *  rule's 6px-each-side breathing room is already supplied on both sides of it;
 *  adding my-1.5 too made a section break 61px instead of 49 and the column read
 *  as loosely grouped rather than sectioned. */
function RailRule() {
  return <span aria-hidden className="block h-px w-9 bg-line" />;
}

/** Shared by both row kinds: the hover/focus wiring that opens a flyout in the
 *  collapsed rail, plus the panel itself. Empty at 240px, where the row already
 *  shows everything the flyout would. */
type FlyoutProps = {
  onMouseEnter?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave?: () => void;
  onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
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
  collapsed,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onClick,
  flyout,
  ...rest
}: {
  node: RailNode;
  nested?: boolean;
  noStats?: boolean;
  active: boolean;
  collapsed?: boolean;
  "aria-current"?: "page";
} & FlyoutProps) {
  // Collapsed: a uniform tile, nothing else. The name, spark and delta the
  // expanded row shows are what the flyout is for.
  if (collapsed) {
    return (
      <div data-rail-node className="relative" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        <RailTile
          as="link"
          href={node.href}
          code={node.railCode ?? node.short ?? "??"}
          label={node.name}
          active={active}
          onFocus={onFocus}
          /* A leaf tile (Stats, Report…) has no panel: a click navigates. Only a
             node that was given flyout wiring intercepts the click. */
          onLinkClick={flyout !== undefined ? onClick : undefined}
          {...rest}
        />
        {flyout}
      </div>
    );
  }

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
          {node.railCode ?? node.short ?? node.name.slice(0, 2).toUpperCase()}
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
 * A category row.
 *
 * r1 made the WHOLE row the toggle with the page behind a hover-only "open →" —
 * which fixed the accidental navigation and created the r3 complaint: two
 * controls on one row with one affordance, nothing saying which was which. Now
 * the chevron is a visible 24px button that only expands, and the label is a
 * link that only navigates — to `/ips#<category>`, the category's own anchor.
 *
 * Keyboard: Tab reaches the chevron, then the label. Enter on the label
 * navigates; Enter/Space on the chevron toggles (a real button); Right opens and
 * Left closes, the tree-widget convention, so nobody toggles blind.
 */
function RailBranch({
  node,
  open,
  count,
  collapsed,
  active,
  onToggle,
  onSetOpen,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onClick,
  flyout,
}: {
  node: RailNode;
  open: boolean;
  count: number;
  collapsed: boolean;
  /** The category page itself is the current route (/ips#<key>). */
  active: boolean;
  onToggle: () => void;
  onSetOpen: (open: boolean) => void;
} & FlyoutProps) {
  // ⚠️ COLLAPSED, A CATEGORY IS A TILE — never a chevron. The chevron is the
  // EXPANDED rail's disclosure; at 56px there is nothing to disclose into, and
  // three bare "›" glyphs beside three codes is what made the column read as
  // debug output. The flyout already lists the category's IPs on hover.
  if (collapsed) {
    return (
      <div data-rail-node className="relative" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        <RailTile
          as="link"
          href={node.href}
          code={node.railCode ?? node.short ?? "??"}
          label={`${node.name} (${count} IPs)`}
          active={false}
          onFocus={onFocus}
          onLinkClick={onClick}
        />
        {flyout}
      </div>
    );
  }

  return (
    <div data-rail-node className="relative" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {/* ⚠️ TWO CONTROLS, TWO AFFORDANCES (nav r3). The chevron is a 24px button
          that only expands; the label is a link that only navigates — to the
          category's own anchor on /ips, so "Sports" and "TCG" no longer land on
          the same top of page. Neither can do the other's job by accident, and
          the browser's own status line shows the label's destination on hover
          the way it does for a tape item. The link is a SIBLING of the button:
          an <a> inside a <button> is invalid, and both need their own focus. */}
      <div
        className={`group mx-1 flex items-center rounded-lg transition-colors ${
          active ? "bg-bg-2 text-ink" : "hover:bg-bg-1"
        }`}
      >
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
          title={open ? "Collapse" : "Expand"}
          /* 24px hit area, visibly a control: its own hover fill, one step up.
             ⚠️ NO MARGIN OF ITS OWN — the row's mx-1 already insets it, and the
             13px the wider chevron costs against r1's 11px glyph is paid back by
             the tighter gaps below, or "Sports" truncates to "Sp…" at 240px. */
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-bg-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
        >
          <span aria-hidden className="rail-chevron" data-open={open ? "" : undefined}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>

        <Link
          href={node.href}
          onFocus={onFocus}
          aria-current={active ? "page" : undefined}
          title={`${node.name} · ${node.href}`}
          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-lg py-1.5 pl-0.5 pr-2 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60 ${
            active ? "text-ink" : "text-ink-2 hover:text-ink"
          }`}
        >
          <span
            aria-hidden
            className={`rail-code w-6 shrink-0 text-center font-mono text-[9.5px] uppercase tracking-[0.04em] ${
              active ? "text-yellow" : "text-ink-4"
            }`}
          >
            {node.railCode ?? node.short ?? node.name.slice(0, 2).toUpperCase()}
          </span>
          <span className="rail-label min-w-0 flex-1 truncate">{node.name}</span>
          {/* How many IPs are behind the row — the reason to open it. */}
          <span className="rail-label shrink-0 rounded bg-bg-2 px-1 font-mono text-[9.5px] leading-[1.4] text-ink-4">
            {count}
          </span>
          <span className="rail-stats flex shrink-0 items-center">
            <RailSpark node={node} />
          </span>
        </Link>
      </div>
      {flyout}
    </div>
  );
}
