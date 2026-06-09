"use client";

import { useEffect, useRef, useState } from "react";
import { RARITY_META, type CoverflowHit } from "@/lib/data/gachaHits";
import { cardHref, cardSupported } from "@/lib/card/ids";
import type { Chain } from "@/lib/types";

/**
 * 3D coverflow of the biggest gacha hits. Layout is derived from `featured`
 * state and rendered as inline transforms, so the cards are positioned on the
 * very first paint (no mount-effect dependency) and CSS transitions animate
 * every change. Drag / wheel / keyboard are layered on as progressive
 * enhancement. See COMPONENT-gacha-coverflow.md for the spec.
 */
const NEAR = 210,
  FAR = 72,
  SCALE_STEP = 0.16,
  ROT = 26,
  OP_STEP = 0.26,
  MINSCALE = 0.5;

type Layout = { transform: string; opacity: number; zIndex: number; pointer: "auto" | "none" };

function layoutFor(off: number): Layout {
  const a = Math.abs(off),
    s = Math.sign(off);
  const x = a <= 1 ? off * NEAR : s * (NEAR + (a - 1) * FAR);
  const opacity = Math.max(0, 1 - a * OP_STEP);
  return {
    transform: `translate3d(${x}px,0,${-a * 60}px) rotateY(${Math.max(-46, Math.min(46, -off * ROT))}deg) scale(${Math.max(MINSCALE, 1 - a * SCALE_STEP)})`,
    opacity,
    zIndex: Math.round(1000 - a * 10),
    pointer: opacity < 0.15 ? "none" : "auto",
  };
}

export function GachaHitsCoverflow({
  hits,
  windowLabel,
}: {
  hits: CoverflowHit[];
  windowLabel: string;
}) {
  const N = hits.length;
  const [featured, setFeatured] = useState(0);
  const featuredRef = useRef(0);
  featuredRef.current = featured;
  const flowRef = useRef<HTMLDivElement | null>(null);
  const cardEls = useRef<(HTMLDivElement | null)[]>([]);

  const go = (t: number) => setFeatured(Math.max(0, Math.min(N - 1, t)));

  // Drag / wheel / keyboard — progressive enhancement. Navigation (arrows,
  // dots, card click) works without this via plain React handlers.
  useEffect(() => {
    const flow = flowRef.current;
    if (!flow || N === 0) return;

    const paint = (p: number) => {
      cardEls.current.forEach((el, i) => {
        if (!el) return;
        const l = layoutFor(i - p);
        el.style.transform = l.transform;
        el.style.opacity = String(l.opacity);
        el.style.zIndex = String(l.zIndex);
        el.classList.toggle("ghc-card--active", Math.round(p) === i);
      });
    };

    let dragging = false,
      startX = 0,
      startPos = 0,
      moved = false,
      pos = featuredRef.current;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      moved = false;
      startX = e.clientX;
      startPos = featuredRef.current;
      pos = startPos;
      flow.classList.add("ghc-flow--dragging");
      flow.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      pos = Math.max(-0.45, Math.min(N - 0.55, startPos - dx / NEAR));
      paint(pos);
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      flow.classList.remove("ghc-flow--dragging");
      const next = Math.max(0, Math.min(N - 1, Math.round(pos)));
      paint(next); // settle (transition re-enabled) — matches what React will render
      setFeatured(next);
    };
    flow.addEventListener("pointerdown", onDown);
    flow.addEventListener("pointermove", onMove);
    flow.addEventListener("pointerup", onUp);
    flow.addEventListener("pointercancel", onUp);

    let wheelAcc = 0;
    let wheelT: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(wheelAcc) > 50) {
        setFeatured((f) => Math.max(0, Math.min(N - 1, f + (wheelAcc > 0 ? 1 : -1))));
        wheelAcc = 0;
      }
      clearTimeout(wheelT);
      wheelT = setTimeout(() => (wheelAcc = 0), 140);
    };
    flow.addEventListener("wheel", onWheel, { passive: false });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setFeatured((f) => Math.max(0, f - 1));
      if (e.key === "ArrowRight") setFeatured((f) => Math.min(N - 1, f + 1));
    };
    window.addEventListener("keydown", onKey);

    const onClickCapture = (e: MouseEvent) => {
      if (moved) {
        e.stopPropagation();
        e.preventDefault();
        moved = false;
      }
    };
    flow.addEventListener("click", onClickCapture, true);

    return () => {
      flow.removeEventListener("pointerdown", onDown);
      flow.removeEventListener("pointermove", onMove);
      flow.removeEventListener("pointerup", onUp);
      flow.removeEventListener("pointercancel", onUp);
      flow.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      flow.removeEventListener("click", onClickCapture, true);
    };
  }, [N]);

  if (N === 0) {
    return (
      <section className="ghc">
        <Header windowLabel={windowLabel} />
        <div className="ghc-empty">No gacha hits to show yet — check back after the next pulls land.</div>
      </section>
    );
  }

  const f = hits[featured] ?? hits[0];

  return (
    <section className="ghc">
      <Header windowLabel={windowLabel} />

      <div className="ghc-flow-wrap">
        <button
          type="button"
          className="ghc-arrow ghc-arrow--prev"
          onClick={() => go(featured - 1)}
          aria-label="Previous hit"
        >
          <Chevron dir="left" />
        </button>

        <div
          className="ghc-flow"
          ref={flowRef}
          role="listbox"
          aria-roledescription="carousel"
          aria-label="Biggest gacha hits"
        >
          {hits.map((h, i) => {
            const r = RARITY_META[h.rarity];
            const l = layoutFor(i - featured);
            return (
              <div
                key={`${h.mint}:${i}`}
                ref={(el) => {
                  cardEls.current[i] = el;
                }}
                className={`ghc-card${i === featured ? " ghc-card--active" : ""}`}
                style={
                  {
                    "--rar": r.color,
                    "--rarGlow": r.glow,
                    transform: l.transform,
                    opacity: l.opacity,
                    zIndex: l.zIndex,
                    pointerEvents: l.pointer,
                  } as React.CSSProperties
                }
                onClick={() => go(i)}
                role="option"
                aria-selected={featured === i}
                aria-label={`Rank ${h.rank}: ${h.name}, ${h.hit}`}
              >
                <div className="ghc-card-inner">
                  <div className="ghc-art">
                    <div className="ghc-holo" />
                    <span className="ghc-rank">#{h.rank}</span>
                    {h.grade && <span className="ghc-grade">{h.grade}</span>}
                    <HitArt hit={h} />
                  </div>
                  <div className="ghc-foot">
                    <span className="ghc-rarity-tag">{r.label}</span>
                    <span className="ghc-nm">{h.name}</span>
                    <div className="ghc-foot-row">
                      <span className="ghc-set">{h.set}</span>
                      <span className="ghc-val" style={{ color: r.color }}>
                        {h.hit}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="ghc-arrow ghc-arrow--next"
          onClick={() => go(featured + 1)}
          aria-label="Next hit"
        >
          <Chevron dir="right" />
        </button>
      </div>

      <div className="ghc-detail">
        <div className="ghc-pull-line">
          <div className="ghc-chip">
            <span className="ghc-l">Hit Value</span>
            <span className="ghc-v ghc-green">{f.hit}</span>
          </div>
          <div className="ghc-chip">
            <span className="ghc-l">Rarity</span>
            <span className="ghc-v" style={{ color: RARITY_META[f.rarity].color }}>
              {RARITY_META[f.rarity].label}
            </span>
          </div>
          <div className="ghc-chip">
            <span className="ghc-l">Return</span>
            {f.mult ? <span className="ghc-mult">{f.mult}</span> : <SoonPill />}
          </div>
        </div>

        <div className="ghc-meta">
          <span className={`ghc-chain ghc-chain--${chainCls(f.chain)}`}>{f.chain}</span>
          <span>{f.platform}</span>
          <span>·</span>
          <span>{f.ago}</span>
          {cardSupported(f.platformKey) && (
            <>
              <span>·</span>
              <a className="ghc-view" href={cardHref(f.platformKey, f.mint)}>
                View card →
              </a>
            </>
          )}
        </div>

        <div className="ghc-dots">
          {hits.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`ghc-dot ${featured === i ? "ghc-dot--on" : ""}`}
              onClick={() => go(i)}
              aria-label={`Go to hit ${i + 1}`}
            />
          ))}
        </div>
        <div className="ghc-hint">drag · scroll · ← → · click a card</div>
      </div>
    </section>
  );
}

/* ───────────────────────── sub-components ───────────────────────── */

function Header({ windowLabel }: { windowLabel: string }) {
  return (
    <div className="ghc-head">
      <span className="ghc-badge">
        <span className="ghc-livedot" /> Live
      </span>
      <h2 className="ghc-title">
        Biggest <span className="ghc-accent">Gacha Hits</span>
      </h2>
      <div className="ghc-sub">
        <span>{windowLabel}</span>
        <span>·</span>
        <span>across all platforms</span>
      </div>
    </div>
  );
}

function HitArt({ hit }: { hit: CoverflowHit }) {
  const sources = [hit.image, hit.imageFallback].filter((s): s is string => Boolean(s));
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(sources.length === 0);
  const src = sources[idx];
  const color = RARITY_META[hit.rarity].color;
  return (
    <>
      <SlabGlyph color={color} />
      {src && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={hit.name}
          className="ghc-img"
          loading="lazy"
          onError={() => {
            if (idx + 1 < sources.length) setIdx(idx + 1);
            else setFailed(true);
          }}
        />
      )}
    </>
  );
}

function SlabGlyph({ color }: { color: string }) {
  return (
    <svg className="ghc-slab" viewBox="0 0 64 92" aria-hidden>
      <rect x="4" y="4" width="56" height="84" rx="7" fill="#0e0e0e" stroke={color} strokeWidth="1.25" opacity="0.55" />
      <rect x="9" y="9" width="46" height="11" rx="2" fill={color} opacity="0.15" />
      <rect x="9" y="24" width="46" height="50" rx="2" fill={color} opacity="0.07" />
      <circle cx="32" cy="46" r="12" fill={color} opacity="0.22" />
      <circle cx="32" cy="46" r="5" fill={color} opacity="0.4" />
      <rect x="9" y="78" width="46" height="6" rx="1" fill={color} opacity="0.12" />
    </svg>
  );
}

function SoonPill() {
  return <span className="ghc-soon">Soon</span>;
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {dir === "left" ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
    </svg>
  );
}

function chainCls(chain: Chain): string {
  return chain === "Polygon" ? "poly" : chain === "Solana" ? "sol" : chain === "Base" ? "base" : "eth";
}
