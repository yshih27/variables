"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  csvFromSeries,
  downloadCsv,
  downloadPng,
  embedSnippet,
  pngFromSvg,
  shareHref,
  type ExportMeta,
  type ExportSeries,
  type PngLegendItem,
} from "@/lib/chart/export";

/**
 * CSV · PNG · Share · Embed, for any chart card (north-star Move 10).
 *
 * ⚠️ IT MOUNTS IN THE CONTROL BAND AND MUST NOT CHANGE ITS HEIGHT. Same rule the
 * D/W/M toggles follow: these are the same 24px control shape the mode switches
 * beside them already use, so a card that gains actions keeps its frame — which
 * matters because half these cards sit in §7 pairs whose bottoms have to agree.
 *
 * ⚠️ EVERY ARTEFACT CARRIES THE HONESTY NOTE. `meta.readMe` goes into the CSV
 * header and onto the PNG beneath the title, so a chart that leaves the site
 * cannot arrive somewhere else stripped of what makes it readable.
 *
 * Degrades rather than lies: with no `svgRef` the PNG button is absent (not
 * broken), with no series the CSV button is absent, with no `chartId` there is no
 * embed. A card wires what it can actually export.
 */
export function ChartActions({
  meta,
  series,
  svgRef,
  plotHeight = 260,
  legend,
  chartId,
  className = "",
}: {
  meta: ExportMeta;
  /** Omit to hide CSV — a chart with no tabular form should not offer one. */
  series?: ExportSeries[];
  /** The chart's live <svg>. Omit to hide PNG. */
  svgRef?: RefObject<SVGSVGElement | null>;
  plotHeight?: number;
  legend?: PngLegendItem[];
  /** `/embed/[chart]` id. Omit to hide Embed. */
  chartId?: string;
  className?: string;
}) {
  const [toast, setToast] = useState<string | null>(null);
  const [embedOpen, setEmbedOpen] = useState(false);
  const timer = useRef<number | null>(null);

  const say = useCallback((m: string) => {
    setToast(m);
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 1600);
  }, []);
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); }, []);

  const onCsv = () => {
    if (!series?.length) return;
    downloadCsv(csvFromSeries(series, meta), meta);
    say("CSV downloaded");
  };

  const onPng = async () => {
    const svg = svgRef?.current;
    if (!svg) return;
    const width = Math.max(320, Math.round(svg.getBoundingClientRect().width) || 860);
    const blob = await pngFromSvg(svg, meta, { width, plotHeight, legend });
    if (!blob) return say("PNG export blocked here");
    downloadPng(blob, meta);
    say("PNG downloaded");
  };

  const onShare = () => {
    navigator.clipboard?.writeText(shareHref()).then(
      () => say("Link copied — opens this exact view"),
      () => say("Copy blocked"),
    );
  };

  return (
    <div className={`relative flex items-center gap-1 ${className}`}>
      {series?.length ? <Btn onClick={onCsv} label="CSV" title="Download CSV" /> : null}
      {svgRef ? <Btn onClick={() => void onPng()} label="PNG" title="Download PNG (carries the note and as-of)" /> : null}
      <Btn onClick={onShare} label="Share" title="Copy a link to this exact view" />
      {chartId ? <Btn onClick={() => setEmbedOpen(true)} label="Embed" title="Embed this chart" /> : null}

      {toast && (
        <span
          role="status"
          className="pointer-events-none absolute right-0 top-full z-30 mt-1 whitespace-nowrap rounded-md border border-line-2 bg-bg-2 px-2 py-1 font-mono text-[10.5px] text-ink-2"
        >
          {toast}
        </span>
      )}

      {embedOpen && chartId && (
        <EmbedDialog chartId={chartId} title={meta.title} onClose={() => setEmbedOpen(false)} onCopied={() => say("Embed code copied")} />
      )}
    </div>
  );
}

/** The control-band button. Same box as the studio's IconBtn, so a band that
 *  gains these keeps its height. */
function Btn({ onClick, label, title }: { onClick: () => void; label: string; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="rounded-md border border-line px-2 py-1 font-mono text-[11px] text-ink-3 transition-colors hover:border-line-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
    >
      {label}
    </button>
  );
}

function EmbedDialog({
  chartId,
  title,
  onClose,
  onCopied,
}: {
  chartId: string;
  title: string;
  onClose: () => void;
  onCopied: () => void;
}) {
  const code = embedSnippet(chartId, { title: `Varible — ${title}` });
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Embed this chart"
        tabIndex={-1}
        ref={(el) => el?.focus()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        className="relative w-full max-w-[560px] rounded-2xl border border-line-2 bg-bg-1 p-4 font-sans shadow-[0_24px_64px_rgba(0,0,0,0.6)] focus:outline-none"
      >
        <h2 className="text-[14px] font-semibold">Embed “{title}”</h2>
        <p className="mt-1 text-[11.5px] text-ink-3">
          Read-only, served from the same cached data as this page, watermarked and dated.
        </p>
        <pre className="scroll-x mt-3 whitespace-pre rounded-lg border border-line bg-bg px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink-2">
          {code}
        </pre>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-3 hover:text-ink"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(code).then(onCopied, onCopied);
              onClose();
            }}
            className="rounded-md bg-yellow px-3 py-1.5 text-[12px] font-semibold text-black hover:bg-yellow-2"
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}
