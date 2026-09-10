import {
  BRAND_LIME,
  BRAND_LOCKUP_ASPECT,
  BRAND_LOCKUP_MARK_PATH,
  BRAND_LOCKUP_VIEWBOX,
  BRAND_LOCKUP_WORDMARK_PATH,
} from "@/lib/brand";
import { SITE_ORIGIN } from "@/lib/site";

/**
 * Universal chart export (north-star Move 10) — CSV, PNG, share and embed for
 * ANY chart card, extracted from the Index Studio rather than duplicated.
 *
 * Every screenshot that leaves the site is distribution, so every artefact this
 * produces carries three things the studio's exports already carried and the
 * rest of the app did not: the chart's own title, its HONESTY NOTE (the readMe
 * line — the thing that makes the number readable), and the data's AS-OF date.
 *
 * ⚠️ AS-OF IS THE DATA'S, NEVER THE CLOCK'S. An export stamped with render time
 * claims a freshness the numbers may not have; a chart whose newest complete day
 * is Sep 6 says Sep 6 even if it is downloaded in October. Callers pass it; this
 * module never reads `Date.now()`.
 */

// ── PNG chrome geometry (the studio's, now shared) ───────────────────────────
export const EXPORT_PAD = 14;
export const LEGEND_TOP = 55;
/** Mono advance width at 10.5px — the basis for every text-fit estimate here. */
const MONO_CH = 6.2;
export const LEGEND_ROW_H = 15;
export const FOOTER_H = 24;

/** The host, derived — never hardcoded. Moving the domain is an env change
 *  (src/lib/site.ts); a hardcoded export would point at the old one forever. */
export const EXPORT_HOST = SITE_ORIGIN.replace(/^https?:\/\//, "");

export type ExportPoint = { ts: string; value: number };
export type ExportSeries = { key: string; label: string; color?: string; points: ExportPoint[] };

/** What an artefact has to be able to say about itself. */
export type ExportMeta = {
  title: string;
  /** The chart's readMe. Carried onto the PNG and into the CSV header — an
   *  exported chart without its honesty note is the number without its receipt. */
  readMe?: string;
  /** Glossary metric key, so a CSV row can be traced back to a definition. */
  metricKey?: string;
  /** Units exactly as the glossary states them ("USD", "cards", "%"). */
  unit: string;
  /** Human window ("last 30 complete days"). */
  window?: string;
  /** The DATA's as-of, ISO or YYYY-MM-DD. Null when the chart has none. */
  asOf?: string | null;
  /**
   * The disclosure receipt, for a surface that shows one on the page (the index:
   * `indexReceipt()` — cadence, latest month end, resale skew, cap anchor).
   *
   * ⚠️ IT TRAVELS OR THE PICTURE LIES BY OMISSION. The index runs warmer than the
   * whole market BY CONSTRUCTION — it follows what resells — and the receipt is
   * where that is disclosed. An exported index image without it is a level with
   * no stated bias, pasted into someone else's deck, and nothing on the artefact
   * would tell the next reader to go looking. So it is a first-class field here
   * rather than folded into `readMe`, which the chart already spends on how to
   * read the shape.
   */
  receipt?: string | null;
  /** Filename stem; slugified from the title when absent. */
  slug?: string;
};

/**
 * XML-escape text bound for the export SVG. Load-bearing, not defensive: the
 * default chart carries "S&P 500", and a bare & makes the document unparseable —
 * the image fails to decode and the download silently dies.
 */
export function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chart";
}

/** CSV-escape a cell: quote when it could otherwise break the row. */
function cell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * CSV: a commented header carrying the metric, unit, window and as-of, then
 * `date` plus one column per series.
 *
 * ⚠️ A BLANK CELL MEANS "NO READING THAT DAY", never zero. The studio learned
 * this the hard way — carrying a weekly value across the daily rows around it
 * exported V-MKT as if it were sampled daily.
 */
/** The comment block every CSV opens with — one definition, so a table export and
 *  a series export carry the same receipt. */
function csvHeader(meta: ExportMeta): string[] {
  return [
    `# ${meta.title}`,
    meta.readMe ? `# ${meta.readMe}` : null,
    meta.receipt ? `# ${meta.receipt}` : null,
    `# metric: ${meta.metricKey ?? "—"} · unit: ${meta.unit}${meta.window ? ` · window: ${meta.window}` : ""}`,
    `# as of: ${meta.asOf ? String(meta.asOf).slice(0, 10) : "—"} · source: ${EXPORT_HOST}`,
  ].filter(Boolean) as string[];
}

export function csvFromSeries(series: ExportSeries[], meta: ExportMeta): string {
  const head = csvHeader(meta);

  const days = [
    ...new Set(series.flatMap((s) => s.points.filter((p) => Number.isFinite(p.value)).map((p) => p.ts.slice(0, 10)))),
  ].sort();
  const at = series.map((s) => {
    const m = new Map<string, number>();
    for (const p of s.points) if (Number.isFinite(p.value)) m.set(p.ts.slice(0, 10), p.value);
    return m;
  });

  const rows = [`date,${series.map((s) => cell(s.label)).join(",")}`];
  for (const d of days) {
    rows.push(`${d},${at.map((m) => (m.has(d) ? String(m.get(d)) : "")).join(",")}`);
  }
  return [...head, ...rows].join("\n");
}

/**
 * A TABLE as CSV — the movers boards, the biggest-sales list.
 *
 * ⚠️ A TABLE IS NOT A PICTURE, so these surfaces export CSV and nothing else.
 * Rasterizing a list of rows produces an image nobody can sort, filter or paste
 * into a model, which is the entire reason someone wanted the data. They carry
 * the same header block as a series CSV, so provenance does not depend on which
 * shape the surface happened to be.
 *
 * `null` is written as an EMPTY CELL, never as 0 — the same honest-absence rule
 * the tables themselves follow.
 */
export type ExportRows = { columns: string[]; rows: (string | number | null | undefined)[][] };

export function csvFromRows(table: ExportRows, meta: ExportMeta): string {
  const head = csvHeader(meta);
  const body = [
    table.columns.map(cell).join(","),
    ...table.rows.map((r) =>
      r.map((v) => (v == null || (typeof v === "number" && !Number.isFinite(v)) ? "" : cell(String(v)))).join(","),
    ),
  ];
  return [...head, ...body].join("\n");
}

/** Trigger a browser download for a blob. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(csv: string, meta: ExportMeta): void {
  downloadBlob(`varible-${meta.slug ?? slugify(meta.title)}.csv`, new Blob([csv], { type: "text/csv" }));
}

/**
 * The VARIBLE lockup, ghosted behind the plot — mark and wordmark straight from
 * the brand SSOT, so an artwork revision reaches every export without anyone
 * remembering this file exists.
 *
 * Colours are LITERAL because this is rasterized where var() resolves to nothing.
 */
export function watermarkSvg(plotW: number, centerY: number): string {
  const [vx, vy, vw] = BRAND_LOCKUP_VIEWBOX.split(/\s+/).map(Number);
  const targetW = plotW * 0.42;
  const s = targetW / vw;
  const targetH = targetW / BRAND_LOCKUP_ASPECT;
  const tx = (plotW - targetW) / 2;
  const ty = centerY - targetH / 2;
  return (
    `<g opacity="0.07" transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(5)}) translate(${-vx} ${-vy})">` +
    `<path d="${BRAND_LOCKUP_MARK_PATH}" fill="${BRAND_LIME}"/>` +
    `<path d="${BRAND_LOCKUP_WORDMARK_PATH}" fill="#ffffff"/>` +
    `</g>`
  );
}

/**
 * Resolve `var(--…)` against the live document.
 *
 * ⚠️ REQUIRED, not an optimisation. A serialized SVG rasterized through <img> is
 * its OWN document with no access to this page's :root, so `var(--…)` resolves to
 * nothing: strokes vanish and fills go black. The substituted value lands inside
 * a double-quoted XML attribute and the font vars resolve WITH double quotes, so
 * they are re-quoted single or the attribute closes early and nothing parses.
 */
function inlineVars(s: string): string {
  const root = getComputedStyle(document.documentElement);
  return s.replace(/var\((--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (m, name: string, fallback?: string) => {
    const v = root.getPropertyValue(name).trim() || (fallback ? fallback.trim() : m);
    return v.replace(/"/g, "'");
  });
}

export type PngLegendItem = { color: string; text: string };

/**
 * PNG — a SELF-DESCRIBING image, not a screenshot of the plot.
 *
 * A plot alone travels badly: pasted into a deck it is unlabelled lines with no
 * scale, no dates and no way back to the source. So the export wraps the LIVE svg
 * in chrome that exists only in the file — title, honesty note, window, legend,
 * watermark and host.
 *
 * The chrome is drawn into the export only, never into the live DOM.
 */
export function exportSvgDocument(
  plotXml: string,
  meta: ExportMeta,
  opts: { width: number; plotHeight: number; legend?: PngLegendItem[] },
): { svg: string; width: number; height: number } {
  const { width: w, plotHeight } = opts;
  const legend = opts.legend ?? [];

  // Flow the legend onto as many rows as it needs; the header grows to fit, so a
  // dozen series cannot spill off the canvas. Width is estimated from character
  // count because there is nothing to measure in a document that doesn't exist yet.
  const SWATCH = 7;
  let cx = EXPORT_PAD;
  let row = 0;
  const placed = legend.map((item) => {
    const wide = SWATCH + 4 + item.text.length * MONO_CH;
    if (cx > EXPORT_PAD && cx + wide > w - EXPORT_PAD) {
      cx = EXPORT_PAD;
      row += 1;
    }
    const at = { ...item, x: cx, row };
    cx += wide + 13;
    return at;
  });

  const basis = [meta.window, meta.asOf ? `as of ${String(meta.asOf).slice(0, 10)}` : null]
    .filter(Boolean)
    .join(" · ");

  /**
   * ⚠️ THE HEADER LINES WRAP; THEY DO NOT RUN OFF THE CANVAS. A chart exported at
   * its on-screen width can be narrow — the homepage index is ~400px — and the
   * receipt is one of the longest lines the app writes. Clipped, it read
   * "…resale skew +1.8 pts/mo" with the cap anchor cut off: a disclosure that
   * silently loses half of itself at small sizes. There is nothing to measure in a
   * document that does not exist yet, so the fit is estimated from the mono
   * advance width, the same way the legend's own flow above is.
   */
  const maxChars = Math.max(16, Math.floor((w - EXPORT_PAD * 2) / MONO_CH));
  const wrap = (text: string): string[] => {
    if (text.length <= maxChars) return [text];
    const out: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
      else { out.push(line); line = word; }
    }
    if (line) out.push(line);
    return out;
  };

  /**
   * The mono block under the title: the window this covers, then the DISCLOSURE
   * that qualifies it, then how to read the shape. Order is deliberate — a reader
   * who stops after two lines has still seen the receipt. Every one of them
   * travels with the picture (the brief's "notes survive on every artefact").
   */
  const noteLines = [basis, meta.receipt, meta.readMe]
    .filter(Boolean)
    .flatMap((t) => wrap(t as string));
  const HEAD_LINE_H = 14;
  const HEAD_FIRST_Y = 36;

  const legendTop = HEAD_FIRST_Y + noteLines.length * HEAD_LINE_H + 5;
  const headH = legend.length ? legendTop + (row + 1) * LEGEND_ROW_H + 6 : legendTop;
  const height = headH + plotHeight + FOOTER_H;

  const chrome =
    `<text x="${EXPORT_PAD}" y="21" fill="#f2f2f3" font-size="15" font-weight="700" font-family="'Inter', sans-serif">${escXml(meta.title)}</text>` +
    noteLines
      .map(
        (t, k) =>
          `<text x="${EXPORT_PAD}" y="${HEAD_FIRST_Y + k * HEAD_LINE_H}" fill="#8a8a92" font-size="10.5" font-family="'JetBrains Mono', monospace">${escXml(t)}</text>`,
      )
      .join("") +
    placed
      .map(
        (pI) =>
          `<rect x="${pI.x}" y="${legendTop + pI.row * LEGEND_ROW_H - SWATCH}" width="${SWATCH}" height="${SWATCH}" fill="${pI.color}"/>` +
          `<text x="${pI.x + SWATCH + 4}" y="${legendTop + pI.row * LEGEND_ROW_H}" fill="#c9c9cf" font-size="10.5" font-family="'JetBrains Mono', monospace">${escXml(pI.text)}</text>`,
      )
      .join("") +
    `<text x="${w - EXPORT_PAD}" y="${height - 9}" fill="#5a5a63" font-size="10" text-anchor="end" font-family="'JetBrains Mono', monospace">${escXml(EXPORT_HOST)}</text>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${height * 2}" viewBox="0 0 ${w} ${height}">` +
    `<rect width="${w}" height="${height}" fill="#0a0a0c"/>` +
    watermarkSvg(w, headH + plotHeight / 2) +
    `<g transform="translate(0 ${headH})">${plotXml}</g>` +
    chrome +
    `</svg>`;

  return { svg, width: w * 2, height: height * 2 };
}

/**
 * PNG — a SELF-DESCRIBING image, not a screenshot of the plot.
 *
 * A plot alone travels badly: pasted into a deck it is unlabelled lines with no
 * scale, no dates and no way back to the source. So the export wraps the LIVE svg
 * in chrome that exists only in the file — title, honesty note, window, legend,
 * watermark and host. The chrome is drawn into the export only, never the DOM.
 *
 * ⚠️ ASSEMBLY IS `exportSvgDocument`, WHICH IS PURE. Only the rasterize step needs
 * a browser, which is what lets the same document be built and checked outside
 * one (see the artefacts in the PR).
 */
export async function pngFromSvg(
  svg: SVGSVGElement,
  meta: ExportMeta,
  opts: { width: number; plotHeight: number; legend?: PngLegendItem[] },
): Promise<Blob | null> {
  // Serialize a COPY minus its opaque background plate, so the watermark sits
  // under the series rather than being buried by it.
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelector("[data-plot-bg]")?.remove();
  const plotXml = inlineVars(new XMLSerializer().serializeToString(clone))
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");

  // ⚠️ THE LEGEND NEEDS THE SAME RESOLUTION AS THE PLOT. Its swatches are drawn
  // into the CHROME, which never passed through `inlineVars`, so a caller giving
  // its colours as `var(--color-yellow)` — every StackedAreaChart does — got a row
  // of BLACK squares beside correctly-coloured bands. Resolved here, where the
  // live document is still in reach, so `exportSvgDocument` stays pure.
  const doc = exportSvgDocument(plotXml, meta, {
    ...opts,
    legend: opts.legend?.map((l) => ({ ...l, color: inlineVars(l.color) })),
  });
  const data = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(doc.svg)}`;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = doc.width;
      cv.height = doc.height;
      const ctx = cv.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.fillStyle = "#0a0a0c";
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0);
      cv.toBlob((bl) => resolve(bl));
    };
    img.onerror = () => resolve(null);
    img.src = data;
  });
}

export function downloadPng(blob: Blob, meta: ExportMeta): void {
  downloadBlob(`varible-${meta.slug ?? slugify(meta.title)}.png`, blob);
}

/**
 * Share: the current URL.
 *
 * The charts that carry state already encode it in the hash (the studio's
 * `#m=…&s=…&w=…&sc=…`, P1-B's grain, the shell's own), so "this exact view" is
 * whatever the address bar already says. A share helper that rebuilt the state
 * itself would be a second encoder to keep in step with the first.
 */
export function shareHref(): string {
  return typeof window === "undefined" ? SITE_ORIGIN : window.location.href;
}

/** The read-only iframe for a chart id, sized for a blog column by default. */
export function embedSnippet(chartId: string, opts?: { width?: number; height?: number; title?: string }): string {
  const w = opts?.width ?? 860;
  const h = opts?.height ?? 460;
  return `<iframe\n  src="${SITE_ORIGIN}/embed/${chartId}"\n  width="${w}" height="${h}" frameborder="0"\n  title="${opts?.title ?? "Varible chart"}">\n</iframe>`;
}

export { slugify as chartSlug };
