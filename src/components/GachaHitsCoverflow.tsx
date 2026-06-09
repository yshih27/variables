"use client";

import { useEffect, useRef, useState } from "react";
import { RARITY_META, type CoverflowHit } from "@/lib/data/gachaHits";
import { cardHref, cardSupported } from "@/lib/card/ids";
import type { Chain } from "@/lib/types";

/**
 * 3D coverflow of the biggest gacha hits. The center card is featured large;
 * neighbors shrink/rotate/fade by depth. Transforms run imperatively in a RAF
 * loop (refs, 60fps); only the featured index lives in React state to drive the
 * detail panel. See COMPONENT-gacha-coverflow.md for the spec.
 */
export function GachaHitsCoverflow({
  hits,
  windowLabel,
}: {
  hits: CoverflowHit[];
  windowLabel: string;
}) {
  const N = hits.length;
  const flowRef = useRef<HTMLDivElement | null>(null);
  const cardEls = useRef<(HTMLDivElement | null)[]>([]);
  const activeRef = useRef(0);
  const targetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const featuredRef = useRef(0);
  const movedRef = useRef(false);
  const goRef = useRef<(t: number) => void>(() => {});
  const [featured, setFeatured] = useState(0);

  useEffect(() => {
    const flow = flowRef.current;
    if (!flow || N === 0) return;
    const cards = cardEls.current;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const NEAR = 210,
      FAR = 72,
      SCALE_STEP = 0.16,
      ROT = 26,
      OP_STEP = 0.26,
      MINSCALE = 0.5;

    const place = (off: number) => {
      const a = Math.abs(off),
        s = Math.sign(off);
      return a <= 1 ? off * NEAR : s * (NEAR + (a - 1) * FAR);
    };

    const render = () => {
      const active = activeRef.current;
      for (let i = 0; i < N; i++) {
        const el = cards[i];
        if (!el) continue;
        const off = i - active,
          a = Math.abs(off);
        const x = place(off);
        const scale = Math.max(MINSCALE, 1 - a * SCALE_STEP);
        const rot = Math.max(-46, Math.min(46, -off * ROT));
        const op = Math.max(0, 1 - a * OP_STEP);
        el.style.transform = `translate3d(${x}px,0,${-a * 60}px) rotateY(${rot}deg) scale(${scale})`;
        el.style.zIndex = String(Math.round(1000 - a * 10));
        el.style.opacity = String(op);
        el.style.pointerEvents = op < 0.15 ? "none" : "auto";
        el.classList.toggle("ghc-card--active", Math.round(active) === i);
      }
      const ri = Math.round(active);
      if (ri !== featuredRef.current && ri >= 0 && ri < N) {
        featuredRef.current = ri;
        setFeatured(ri);
      }
    };

    const loop = () => {
      const t = targetRef.current;
      activeRef.current += (t - activeRef.current) * 0.16;
      if (Math.abs(t - activeRef.current) < 0.0008) activeRef.current = t;
      render();
      rafRef.current = activeRef.current !== t ? requestAnimationFrame(loop) : null;
    };
    const kick = () => {
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(loop);
    };
    const go = (t: number) => {
      targetRef.current = Math.max(0, Math.min(N - 1, t));
      if (reduce) {
        activeRef.current = targetRef.current;
        render();
      } else kick();
    };
    goRef.current = go;

    // initial layout
    targetRef.current = Math.max(0, Math.min(N - 1, targetRef.current));
    activeRef.current = targetRef.current;
    render();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(targetRef.current - 1);
      if (e.key === "ArrowRight") go(targetRef.current + 1);
    };
    window.addEventListener("keydown", onKey);

    let wheelAcc = 0;
    let wheelT: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(wheelAcc) > 50) {
        go(targetRef.current + (wheelAcc > 0 ? 1 : -1));
        wheelAcc = 0;
      }
      clearTimeout(wheelT);
      wheelT = setTimeout(() => (wheelAcc = 0), 140);
    };
    flow.addEventListener("wheel", onWheel, { passive: false });

    let dragging = false,
      startX = 0,
      startActive = 0,
      moved = false;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      moved = false;
      startX = e.clientX;
      startActive = activeRef.current;
      flow.classList.add("ghc-flow--dragging");
      flow.setPointerCapture?.(e.pointerId);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      activeRef.current = Math.max(-0.45, Math.min(N - 0.55, startActive - dx / NEAR));
      render();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      flow.classList.remove("ghc-flow--dragging");
      movedRef.current = moved;
      go(Math.round(activeRef.current));
    };
    flow.addEventListener("pointerdown", onDown);
    flow.addEventListener("pointermove", onMove);
    flow.addEventListener("pointerup", onUp);
    flow.addEventListener("pointercancel", onUp);
    // swallow the click that follows a drag so it doesn't re-center a card
    const onClickCapture = (e: MouseEvent) => {
      if (movedRef.current) {
        e.stopPropagation();
        e.preventDefault();
        movedRef.current = false;
      }
    };
    flow.addEventListener("click", onClickCapture, true);

    return () => {
      window.removeEventListener("keydown", onKey);
      flow.removeEventListener("wheel", onWheel);
      flow.removeEventListener("pointerdown", onDown);
      flow.removeEventListener("pointermove", onMove);
      flow.removeEventListener("pointerup", onUp);
      flow.removeEventListener("pointercancel", onUp);
      flow.removeEventListener("click", onClickCapture, true);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
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
          onClick={() => goRef.current(targetRef.current - 1)}
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
            return (
              <div
                key={`${h.mint}:${i}`}
                ref={(el) => {
                  cardEls.current[i] = el;
                }}
                className="ghc-card"
                style={{ ["--rar"]: r.color, ["--rarGlow"]: r.glow } as React.CSSProperties}
                onClick={() => goRef.current(i)}
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
          onClick={() => goRef.current(targetRef.current + 1)}
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
              onClick={() => goRef.current(i)}
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
  const sources = [hit.image, hit.imageFallback].filter(
    (s): s is string => Boolean(s),
  );
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

/** Rarity-tinted slab silhouette shown behind the image (and if it fails). */
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
