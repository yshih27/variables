"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { IPRow } from "@/lib/types";
import { IPIcon } from "./IPIcon";
import { formatCompactUsd, formatCompactNumber, formatPct } from "@/lib/format";

/**
 * Market-cap treemap for the Categories landing — tiles sized by market cap so
 * the relative scale of every IP is legible at a glance (the market is heavily
 * Pokémon-dominant, and that skew is the story). Mirrors IPTable's mcap
 * suppression so the two stay consistent, and falls back to a dominance-bar
 * list on phones where a treemap can't breathe.
 */

type Rect = { x: number; y: number; w: number; h: number };

/** A treemap cell — an IP, or the synthetic "+N more" tail bucket. */
type Cell = {
  key: string;
  name: string;
  short: string;
  color: string;
  logo?: string;
  iconBlendMode?: IPRow["iconBlendMode"];
  emoji?: string;
  mcapUsd: number;
  cards: number;
  vol24Usd: number;
  pct7d: number | null;
  share: number;
  /** null for the bucket (not a real category page). */
  href: string | null;
};

/** Mirror IPTable's mcap rule: tiny/sparse IPs read "—" there, so they don't
 *  earn a tile here either. */
function qualifies(ip: IPRow): boolean {
  return Number.isFinite(ip.mcapUsd) && ip.mcapUsd >= 1000 && ip.cards >= 5;
}

function buildCells(rows: IPRow[]): { cells: Cell[]; total: number; count: number } | null {
  const q = rows.filter(qualifies).sort((a, b) => b.mcapUsd - a.mcapUsd);
  if (q.length === 0) return null;
  const total = q.reduce((s, r) => s + r.mcapUsd, 0);

  // Below ~0.25% a tile is an unreadable sliver — keep the meaningful heads
  // individual and fold the long tail into one labelled bucket. The full table
  // below carries every category, so nothing is hidden.
  const MIN_SHARE = 0.0025;
  const MIN_TILES = 6;
  const MAX_TILES = 12;

  let k = q.findIndex((r) => r.mcapUsd / total < MIN_SHARE);
  if (k === -1) k = q.length;
  k = Math.min(Math.max(k, Math.min(MIN_TILES, q.length)), MAX_TILES, q.length);
  let rest = q.slice(k);
  if (rest.length === 1) {
    k += 1; // never bucket a lone straggler — just show it
    rest = [];
  }

  const toCell = (r: IPRow): Cell => ({
    key: r.key,
    name: r.name,
    short: r.short,
    color: r.color,
    logo: r.logo,
    iconBlendMode: r.iconBlendMode,
    emoji: r.emoji,
    mcapUsd: r.mcapUsd,
    cards: r.cards,
    vol24Usd: r.vol24Usd,
    pct7d: r.pct7d,
    share: r.mcapUsd / total,
    href: `/ip/${r.key}`,
  });

  const cells = q.slice(0, k).map(toCell);
  if (rest.length >= 2) {
    const sum = rest.reduce((s, r) => s + r.mcapUsd, 0);
    const cards = rest.reduce((s, r) => s + r.cards, 0);
    cells.push({
      key: "__more__",
      name: `+${rest.length} more`,
      short: `+${rest.length}`,
      color: "var(--color-bg-3)",
      mcapUsd: sum,
      cards,
      vol24Usd: 0,
      pct7d: null,
      share: sum / total,
      href: null,
    });
  }
  return { cells, total, count: q.length };
}

// ---- squarified treemap (Bruls, Huizing, van Wijk) -------------------------
function squarify(cells: Cell[], rect: Rect): Array<Cell & Rect> {
  const out: Array<Cell & Rect> = [];
  const total = cells.reduce((s, c) => s + c.mcapUsd, 0) || 1;
  const scale = (rect.w * rect.h) / total;
  const items = cells.map((c) => ({ cell: c, area: c.mcapUsd * scale }));

  let r = { ...rect };
  let row: typeof items = [];
  const sumRow = (rw: typeof items) => rw.reduce((s, it) => s + it.area, 0);

  function worst(rw: typeof items, side: number): number {
    if (rw.length === 0) return Infinity;
    const sum = sumRow(rw);
    let max = -Infinity;
    let min = Infinity;
    for (const it of rw) {
      if (it.area > max) max = it.area;
      if (it.area < min) min = it.area;
    }
    const s2 = side * side;
    const sum2 = sum * sum;
    return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
  }

  function flush(rw: typeof items) {
    const sum = sumRow(rw);
    if (r.w >= r.h) {
      const colW = sum / r.h;
      let cy = r.y;
      for (const it of rw) {
        const ih = it.area / colW;
        out.push({ ...it.cell, x: r.x, y: cy, w: colW, h: ih });
        cy += ih;
      }
      r = { x: r.x + colW, y: r.y, w: r.w - colW, h: r.h };
    } else {
      const rowH = sum / r.w;
      let cx = r.x;
      for (const it of rw) {
        const iw = it.area / rowH;
        out.push({ ...it.cell, x: cx, y: r.y, w: iw, h: rowH });
        cx += iw;
      }
      r = { x: r.x, y: r.y + rowH, w: r.w, h: r.h - rowH };
    }
  }

  for (const it of items) {
    const side = Math.min(r.w, r.h);
    if (row.length === 0 || worst([...row, it], side) <= worst(row, side)) {
      row.push(it);
    } else {
      flush(row);
      row = [it];
    }
  }
  if (row.length) flush(row);
  return out;
}

/** Relative-luminance pick: dark ink on bright fills, light ink on dark fills. */
function inkOn(hex: string): { strong: string; soft: string } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { strong: "rgba(255,255,255,0.96)", soft: "rgba(255,255,255,0.72)" };
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4
    ? { strong: "rgba(10,10,12,0.92)", soft: "rgba(10,10,12,0.64)" }
    : { strong: "rgba(255,255,255,0.97)", soft: "rgba(255,255,255,0.74)" };
}

function pctLabel(share: number): string {
  const p = share * 100;
  if (p >= 10) return `${Math.round(p)}%`;
  if (p >= 0.1) return `${p.toFixed(1)}%`;
  return "<0.1%";
}

export function CategoryTreemap({ rows }: { rows: IPRow[] }) {
  const built = useMemo(() => buildCells(rows), [rows]);
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setW(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!built) return null;
  const { cells, total, count } = built;

  // Wider viewports → flatter map; clamp so it never gets gangly or cramped.
  // Fewer tiles → shorter, so a 2–3 way split reads as intentional rather than
  // a billboard. The map grows toward w/ratio as more categories gain data.
  const ratio = w >= 1024 ? 2.5 : 2.05;
  const maxByCount = 200 + cells.length * 44;
  const h = w > 0 ? Math.max(280, Math.min(540, maxByCount, w / ratio)) : 360;
  const laid = w > 0 ? squarify(cells, { x: 0, y: 0, w, h }) : [];
  const active = hover ? laid.find((t) => t.key === hover) : null;

  return (
    <section className="mb-2 font-sans">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.01em]">Market cap by category</h2>
          <div className="mt-1 text-[12px] text-ink-3">
            Tiles sized by total market cap. Click a category to drill in.
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[20px] font-semibold tabular">{formatCompactUsd(total)}</span>
          <span className="text-[12px] text-ink-3">
            across <span className="tabular">{count}</span> categories
          </span>
        </div>
      </header>

      {/* Treemap — tablet and up */}
      <div className="hidden sm:block">
        <div ref={ref} className="relative w-full select-none" style={{ height: h }}>
          {laid.map((t) => {
            const ink = t.href ? inkOn(t.color) : { strong: "var(--color-ink-2)", soft: "var(--color-ink-3)" };
            const dimmed = hover != null && hover !== t.key;
            const big = t.w >= 122 && t.h >= 80;
            const hero = t.w >= 340 && t.h >= 280;
            const med = !big && t.w >= 82 && t.h >= 48;
            const micro = !big && !med && t.w >= 46 && t.h >= 30;

            const body = (
              <div
                className="flex h-full w-full flex-col items-start justify-start overflow-hidden p-2.5"
                style={{
                  background: t.href ? t.color : "var(--color-bg-2)",
                  border: t.href ? "1.5px solid var(--color-bg)" : "1.5px dashed var(--color-line-2)",
                  color: ink.strong,
                }}
              >
                {big && (
                  <>
                    <div className="flex max-w-full items-center gap-2">
                      {t.href && <IPIcon name={t.name} short={t.short} color={t.color} logo={t.logo} iconBlendMode={t.iconBlendMode} emoji={t.emoji} size={hero ? 30 : 22} />}
                      <span
                        className="truncate font-sans font-semibold leading-tight"
                        style={{ fontSize: hero ? 20 : 14, color: ink.strong }}
                      >
                        {t.name}
                      </span>
                    </div>
                    <span
                      className="mt-1.5 tabular font-semibold leading-none"
                      style={{ fontSize: hero ? 32 : 18 }}
                    >
                      {formatCompactUsd(t.mcapUsd)}
                    </span>
                    <span className="mt-1 tabular leading-none" style={{ fontSize: hero ? 14 : 12, color: ink.soft }}>
                      {pctLabel(t.share)} of market cap
                    </span>
                  </>
                )}
                {med && (
                  <>
                    <span className="truncate font-sans font-semibold leading-tight" style={{ fontSize: 12.5, color: ink.strong }}>
                      {t.name}
                    </span>
                    <span className="mt-1 tabular font-semibold leading-none" style={{ fontSize: 13 }}>
                      {formatCompactUsd(t.mcapUsd)}
                    </span>
                    <span className="mt-0.5 tabular leading-none" style={{ fontSize: 10.5, color: ink.soft }}>
                      {pctLabel(t.share)}
                    </span>
                  </>
                )}
                {micro && (
                  <span className="tabular font-semibold leading-tight" style={{ fontSize: 11, color: ink.strong }}>
                    {t.short}
                  </span>
                )}
              </div>
            );

            const common = "absolute block transition-[filter,opacity] duration-150";
            const style = {
              left: t.x,
              top: t.y,
              width: t.w,
              height: t.h,
              opacity: dimmed ? 0.55 : 1,
              filter: hover === t.key ? "brightness(1.08)" : undefined,
              zIndex: hover === t.key ? 2 : 1,
            } as const;

            return t.href ? (
              <Link
                key={t.key}
                href={t.href}
                aria-label={`${t.name} — ${formatCompactUsd(t.mcapUsd)}, ${pctLabel(t.share)} of category market cap`}
                className={common}
                style={style}
                onMouseEnter={() => setHover(t.key)}
                onMouseLeave={() => setHover(null)}
              >
                {body}
              </Link>
            ) : (
              <div
                key={t.key}
                className={common}
                style={style}
                onMouseEnter={() => setHover(t.key)}
                onMouseLeave={() => setHover(null)}
              >
                {body}
              </div>
            );
          })}

          {active && w > 0 && (
            <div
              className="pointer-events-none absolute z-10 w-[210px] rounded-lg border border-line-2 bg-bg-1/95 p-3 shadow-xl backdrop-blur"
              style={{
                left: Math.max(8, Math.min(active.x + active.w / 2 - 105, w - 218)),
                top: active.y > 96 ? active.y - 8 : active.y + active.h + 8,
                transform: active.y > 96 ? "translateY(-100%)" : undefined,
              }}
            >
              <div className="mb-2 flex items-center gap-2">
                {active.href ? (
                  <IPIcon name={active.name} short={active.short} color={active.color} logo={active.logo} iconBlendMode={active.iconBlendMode} emoji={active.emoji} size={22} />
                ) : (
                  <span className="grid h-[22px] w-[22px] place-items-center rounded-[7px] bg-bg-3 text-[11px] font-bold text-ink-2">
                    {active.short}
                  </span>
                )}
                <span className="font-sans text-[13px] font-semibold">{active.name}</span>
              </div>
              <Row label="Market cap" value={formatCompactUsd(active.mcapUsd)} />
              <Row label="Share" value={pctLabel(active.share)} />
              <Row label="Cards" value={formatCompactNumber(active.cards)} />
              {active.href && <Row label="24h vol" value={active.vol24Usd > 0 ? formatCompactUsd(active.vol24Usd) : "—"} />}
              {active.href && active.pct7d != null && (
                <Row
                  label="7d"
                  value={formatPct(active.pct7d)}
                  valueClass={active.pct7d > 0 ? "text-green" : active.pct7d < 0 ? "text-red" : "text-ink-3"}
                />
              )}
              {!active.href && (
                <div className="mt-1.5 border-t border-line/60 pt-1.5 text-[11px] leading-snug text-ink-3">
                  Smaller categories — see the full table below.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Dominance bars — phones */}
      <div className="flex flex-col gap-1.5 sm:hidden">
        {cells.map((c) => {
          const bar = (
            <>
              <div className="flex items-center gap-2">
                {c.href ? (
                  <IPIcon name={c.name} short={c.short} color={c.color} logo={c.logo} iconBlendMode={c.iconBlendMode} emoji={c.emoji} size={20} />
                ) : (
                  <span className="grid h-5 w-5 place-items-center rounded-[6px] bg-bg-3 text-[10px] font-bold text-ink-2">{c.short}</span>
                )}
                <span className="min-w-0 flex-1 truncate font-sans text-[13px] font-medium">{c.name}</span>
                <span className="tabular text-[13px] font-semibold">{formatCompactUsd(c.mcapUsd)}</span>
                <span className="w-[42px] text-right tabular text-[12px] text-ink-3">{pctLabel(c.share)}</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg-2">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(c.share * 100, 1.5)}%`, background: c.href ? c.color : "var(--color-line-2)" }}
                />
              </div>
            </>
          );
          return c.href ? (
            <Link key={c.key} href={c.href} className="rounded-lg px-2 py-2 transition-colors hover:bg-bg-1">
              {bar}
            </Link>
          ) : (
            <div key={c.key} className="rounded-lg px-2 py-2">
              {bar}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Row({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-[12px]">
      <span className="text-ink-3">{label}</span>
      <span className={`tabular font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}
