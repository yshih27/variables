"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RailModel, RailNode } from "@/lib/types";
import { GACHA_ENABLED } from "@/lib/flags";
import { RailSpark } from "./RailSpark";
import { RAIL_PREF_KEY, type RailPref } from "./railPref";

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
  const [pref, setPref] = useState<RailPref>("open");
  /** EXPLICIT open/closed choices only. Everything else falls through to the
   *  derivation below, so the branch you are standing in is open without an
   *  effect having to push it open after the fact. */
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const navRef = useRef<HTMLElement | null>(null);

  // Read the stored preference AFTER mount. The pre-hydration script has already
  // applied it to the DOM; this only syncs React's copy so the toggle's label is
  // right. Reading it during render would be a hydration mismatch.
  useEffect(() => {
    let v: string | null = null;
    try {
      v = localStorage.getItem(RAIL_PREF_KEY);
    } catch {
      /* blocked storage — the rail just won't remember */
    }
    if (v !== "icons" && v !== "open") return;
    // The one repaint this rule warns about is the intent: storage cannot be read
    // during render without a hydration mismatch, and the DOM already has the
    // right width from the pre-hydration script — this only syncs the toggle's label.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPref(v);
  }, []);

  const setRailPref = useCallback((next: RailPref) => {
    setPref(next);
    document.documentElement.setAttribute("data-rail", next);
    try {
      localStorage.setItem(RAIL_PREF_KEY, next);
    } catch {
      /* blocked storage */
    }
  }, []);

  // The branch you are standing in is open BY DERIVATION, not by an effect that
  // pushes it open after the first paint — a deep link into /ip/pokemon must not
  // render a collapsed TCG and then expand it.
  const activeCategory = model.categories.find((c) => c.ips.some((ip) => isActive(pathname, ip.href)));
  const isOpen = (key: string) => override[key] ?? key === activeCategory?.key;
  const toggle = (key: string) => setOverride((o) => ({ ...o, [key]: !(o[key] ?? key === activeCategory?.key) }));

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

  return (
    <nav
      ref={navRef}
      aria-label="Market taxonomy"
      /* Sticky under the top bar with its OWN scroll — the brief's "rail scroll is
         independent of content scroll". Hidden below lg, where BottomTabs takes over. */
      className="scroll-y sticky top-[var(--shell-chrome-h,var(--shell-topbar-h))] hidden h-[calc(100dvh-var(--shell-chrome-h,var(--shell-topbar-h)))] min-h-0 flex-col overflow-y-auto border-r border-line/70 lg:flex"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-px py-2">
        <RailLink node={model.market} {...nodeProps(model.market.href)} />

        <RailSectionLabel>Categories</RailSectionLabel>
        {model.categories.map((c) => {
          const open = isOpen(c.key);
          return (
            <div key={c.key}>
              <RailBranch node={c} open={open} count={c.ips.length} onToggle={() => toggle(c.key)} />
              {open &&
                c.ips.map((ip) => <RailLink key={ip.key} node={ip} nested {...nodeProps(ip.href)} />)}
            </div>
          );
        })}

        {model.platforms.length > 0 && <RailSectionLabel>Platforms</RailSectionLabel>}
        {model.platforms.map((p) => (
          <RailLink key={p.key} node={p} {...nodeProps(p.href)} />
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

      {/* Collapse control — only where there is a choice. Below 1280 the rail is
          iconised by the viewport, so offering a toggle there would be a lie. */}
      <div className="sticky bottom-0 hidden border-t border-line/70 bg-bg/90 p-2 backdrop-blur-xl xl:block">
        <button
          type="button"
          onClick={() => setRailPref(pref === "icons" ? "open" : "icons")}
          aria-label={pref === "icons" ? "Expand rail" : "Collapse rail to icons"}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-ink-3 transition-colors hover:bg-bg-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
        >
          <span aria-hidden className="font-mono text-[13px] leading-none">
            {pref === "icons" ? "»" : "«"}
          </span>
          <span className="rail-label whitespace-nowrap">Collapse</span>
        </button>
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

/**
 * One navigable node. In the 56px icon rail everything but `short` is hidden by
 * the `.rail-label` / `.rail-stats` classes (CSS, driven by the same
 * `--shell-rail-w` the grid uses) — one width rule, not a second React branch
 * that could disagree with the pre-paint value.
 */
function RailLink({
  node,
  nested,
  noStats,
  active,
  ...rest
}: {
  node: RailNode;
  nested?: boolean;
  noStats?: boolean;
  active: boolean;
  "aria-current"?: "page";
}) {
  return (
    <Link
      {...rest}
      href={node.href}
      title={node.name}
      className={`group mx-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60 ${
        active ? "bg-bg-2 text-ink" : "text-ink-2 hover:bg-bg-1 hover:text-ink"
      } ${nested ? "rail-nested" : ""}`}
    >
      <span
        aria-hidden
        className={`w-9 shrink-0 text-center font-mono text-[9.5px] uppercase tracking-[0.04em] ${
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
  );
}

/** A category row: navigates AND expands. The disclosure is its own button so a
 *  keyboard user can open the branch without leaving the page. */
function RailBranch({
  node,
  open,
  count,
  onToggle,
}: {
  node: RailNode;
  open: boolean;
  count: number;
  onToggle: () => void;
}) {
  return (
    <div className="mx-1 flex items-center gap-1">
      <Link
        href={node.href}
        title={node.name}
        className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:bg-bg-1 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
      >
        <span aria-hidden className="w-9 shrink-0 text-center font-mono text-[9.5px] uppercase tracking-[0.04em] text-ink-4">
          {node.short ?? node.name.slice(0, 3).toUpperCase()}
        </span>
        <span className="rail-label min-w-0 flex-1 truncate">{node.name}</span>
        <span className="rail-stats">
          <RailSpark node={node} />
        </span>
      </Link>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${node.name} (${count} IPs)`}
        className="rail-label shrink-0 rounded-md px-1.5 py-1 font-mono text-[11px] leading-none text-ink-4 transition-colors hover:bg-bg-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
      >
        {open ? "−" : "+"}
      </button>
    </div>
  );
}
