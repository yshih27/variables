"use client";

import { useState } from "react";
import { IPIcon } from "./IPIcon";
import type {
  GachaCatalog,
  GachaCategoryGroup,
  GachaPackOption,
} from "@/lib/data/gachaCatalog";

/**
 * Phygitals-style pack picker: pick a category → pick a pack tier → see its
 * expected value, live payout odds, and a demo spin. Consumes the
 * `GachaCatalog` contract (see gachaCatalog.ts); every not-yet-warmed field
 * degrades to an honest "coming soon" state.
 */
export function GachaPackExplorer({ catalog }: { catalog: GachaCatalog }) {
  const categories = catalog.categories;
  const [catKey, setCatKey] = useState(categories[0]?.key ?? "");
  const category = categories.find((c) => c.key === catKey) ?? categories[0];
  const [packId, setPackId] = useState<string | null>(
    category?.featuredPackId ?? category?.packs[0]?.id ?? null,
  );

  if (!category) return null;
  const selected = category.packs.find((p) => p.id === packId) ?? category.packs[0];

  function onCategoryChange(nextKey: string) {
    const next = categories.find((c) => c.key === nextKey);
    setCatKey(nextKey);
    setPackId(next?.featuredPackId ?? next?.packs[0]?.id ?? null);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-bg-1">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
        <div className="min-w-0">
          <h2 className="text-[26px] font-bold leading-tight tracking-[-0.01em]">
            {selected?.name ?? "Pack"} <span className="text-ink-3">Pack</span>
          </h2>
          {category.note && (
            <p className="mt-1 text-[13px] text-ink-3">{category.note}</p>
          )}
        </div>
        {category.buybackRate != null && (
          <span
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold text-white"
            style={{ background: "linear-gradient(135deg,#1f9d57,#37cf7d)" }}
            title="Share of the pack price the platform will instantly buy your pull back for."
          >
            {Math.round(category.buybackRate * 100)}% Buyback
            <Hint char="i" tone="onGreen" />
          </span>
        )}
      </div>

      <div className="px-6 py-6">
        {/* ── Category ── */}
        <Label>Category</Label>
        <CategoryDropdown
          categories={categories}
          value={category.key}
          onChange={onCategoryChange}
        />

        {/* ── Packs ── */}
        <Label className="mt-6">Pack</Label>
        <div className="grid grid-cols-2 gap-2.5 min-[440px]:grid-cols-4">
          {category.packs.map((p) => (
            <PackTile
              key={p.id}
              pack={p}
              color={category.icon.color}
              selected={p.id === selected?.id}
              onSelect={() => setPackId(p.id)}
            />
          ))}
        </div>

        {/* ── Expected Value ── */}
        <div className="mt-6 flex items-center justify-between rounded-xl bg-bg-2 px-5 py-4">
          <span className="text-[14px] text-ink-2">Expected Value</span>
          {selected?.expectedValueUsd != null ? (
            <span className="flex items-baseline gap-1.5">
              <span className="text-[20px] font-bold tabular">
                {priceLabel(selected.expectedValueUsd)}
              </span>
              <span className="text-[12px] text-ink-3">per pack</span>
              <Hint title="Average realized value of a pull at this tier, from on-chain prize deliveries." />
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <SoonPill />
              <Hint title="Realized expected value lands once per-pack prize data is warmed." />
            </span>
          )}
        </div>

        {/* ── Live Odds ── */}
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <Label className="mb-0">Live Odds</Label>
            <Hint title="Probability your pull lands in each payout band, from realized on-chain prizes." />
          </div>
          {selected?.odds && selected.odds.length > 0 ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {selected.odds.map((o) => (
                <div
                  key={o.rangeLabel}
                  className="rounded-xl border border-line bg-bg-2 px-4 py-3"
                >
                  <div className="text-[12px] text-ink-3 tabular">{o.rangeLabel}</div>
                  <div className="mt-1 text-[20px] font-bold tabular">
                    {(o.prob * 100).toFixed(o.prob < 0.1 ? 1 : 0)}%
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-line-2 bg-bg-1 px-5 py-4">
              <SoonPill />
              <span className="text-[12.5px] text-ink-3">
                Payout odds unlock when realized prize data is warmed for this pack.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Demo spin ── */}
      <DemoSpinBar href={category.demoSpinHref ?? null} />
    </div>
  );
}

/* ───────────────────────────── sub-components ───────────────────────────── */

function Label({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3 ${className}`}
    >
      {children}
    </div>
  );
}

function CategoryDropdown({
  categories,
  value,
  onChange,
}: {
  categories: GachaCategoryGroup[];
  value: string;
  onChange: (key: string) => void;
}) {
  const cat = categories.find((c) => c.key === value);
  return (
    <div className="relative flex h-[52px] items-center gap-3 rounded-xl border border-line bg-bg-1 px-4 transition-colors focus-within:border-line-2">
      {cat && <IPIcon {...cat.icon} size={26} />}
      <span className="text-[16px] font-medium">{cat?.name}</span>
      <ChevronDown className="ml-auto h-4 w-4 text-ink-3" />
      <select
        aria-label="Category"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {categories.map((c) => (
          <option key={c.key} value={c.key}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function PackTile({
  pack,
  color,
  selected,
  onSelect,
}: {
  pack: GachaPackOption;
  color: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-3.5 text-center transition-colors ${
        selected
          ? "border-line-2 bg-bg-2"
          : "border-line bg-bg-1 hover:bg-bg-2"
      }`}
    >
      <PackArt image={pack.image ?? null} color={color} />
      <span className="line-clamp-1 w-full text-[12.5px] leading-tight text-ink-3">
        {pack.name}
      </span>
      <span className="text-[15px] font-bold tabular">{priceLabel(pack.priceUsd)}</span>
    </button>
  );
}

function PackArt({ image, color }: { image: string | null; color: string }) {
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={image}
        alt=""
        className="h-[56px] w-auto object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
      />
    );
  }
  // Placeholder "foil pack": tinted by the category color with a sheen.
  return (
    <span
      className="relative block h-[56px] w-[40px] overflow-hidden rounded-[5px]"
      style={{
        background: `linear-gradient(155deg, ${rgba(color, 0.9)} 0%, ${rgba(color, 0.3)} 55%, rgba(0,0,0,0.65) 100%)`,
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)",
      }}
      aria-hidden
    >
      <span className="absolute -inset-y-2 left-[34%] w-[6px] rotate-12 bg-white/25 blur-[2px]" />
      <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-white/30" />
    </span>
  );
}

function DemoSpinBar({ href }: { href: string | null }) {
  const inner = (
    <>
      <PlayCircle />
      <span className="text-[15px] font-semibold">Try a free demo spin</span>
      {href ? (
        <ArrowRight className="ml-auto h-4 w-4 text-ink-3" />
      ) : (
        <span className="ml-auto text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">
          coming soon
        </span>
      )}
    </>
  );
  const base = "flex items-center gap-3 border-t border-line px-6 py-5";
  if (href) {
    return (
      <a href={href} className={`${base} transition-colors hover:bg-bg-2`}>
        {inner}
      </a>
    );
  }
  return (
    <div
      className={`${base} opacity-70`}
      aria-disabled="true"
      title="Demo spin coming soon"
    >
      {inner}
    </div>
  );
}

function SoonPill() {
  return (
    <span className="inline-flex items-center rounded-md bg-yellow/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-yellow ring-1 ring-inset ring-yellow/20">
      Coming soon
    </span>
  );
}

/** Small circled hint glyph with a native tooltip. */
function Hint({
  char = "?",
  title,
  tone,
}: {
  char?: string;
  title?: string;
  tone?: "onGreen";
}) {
  const cls =
    tone === "onGreen"
      ? "border-white/40 text-white/90"
      : "border-line-2 text-ink-3";
  return (
    <span
      title={title}
      className={`inline-flex h-[15px] w-[15px] items-center justify-center rounded-full border text-[10px] font-semibold ${cls}`}
    >
      {char}
    </span>
  );
}

function ChevronDown({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowRight({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayCircle() {
  return (
    <span
      className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full"
      style={{
        background: "linear-gradient(135deg,#1f9d57,#37cf7d)",
        boxShadow: "0 0 16px rgba(55,207,125,0.45)",
      }}
      aria-hidden
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#06140b">
        <path d="M8 5v14l11-7z" />
      </svg>
    </span>
  );
}

/* ───────────────────────────── helpers ───────────────────────────── */

/** "$10", "$1,000", "$5,000" — full numbers with separators (matches the store). */
function priceLabel(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/** #RRGGBB (or #RGB) → rgba() string. */
function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return `rgba(136,136,136,${a})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}
