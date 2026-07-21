/*
 * Reproduction harness — Index Studio Safari crash (fast scroll / zoom "past the
 * intended frame" against the clamp → WebKit render-process death).
 *
 * This is pass 3 on this component's input handling; the rule now is that a fix
 * ships with a repro, not a code read. The hard crash is a Safari render-process
 * OOM we cannot drive from CI, but its CAUSE — a per-frame commit storm that
 * rebuilds every visible series' path, plus a fully-clamped momentum tail that
 * keeps preventDefault-ing the wheel — is observable in Chromium. This harness
 * makes that observable and asserts the DOM survives.
 *
 * HOW TO RUN (real browser; NOT jsdom/tsx — the failure needs a live event loop):
 *   1. Open /ips (market studio) or /platforms (heavy total_volume series).
 *   2. Paste this whole file into the devtools console.
 *   3. await runWheelStorm();
 *
 * RESULT (before vs after the fix):
 *   commitsPerSec      Phase-A rebuild rate. rAF already caps it (~frame rate);
 *                      the fix cuts the COST of each rebuild, not this count.
 *   rebuildMsAvg/Max   model-rebuild cost (opt-in profiler). Should drop — the
 *                      window slice goes from a full-series O(n) scan to O(log n+k).
 *   clampTailCommits   commits produced while pinned against the clamp. BEFORE:
 *                      one per frame for the whole momentum tail. AFTER: ~0.
 *   clampTailPrevented preventDefault count on the clamped tail. BEFORE: all of
 *                      them (page frozen). AFTER: ~0 — the wheel is released, so a
 *                      real trackpad's momentum scrolls the PAGE instead of
 *                      streaming preventDefault'd no-ops (the crash tail).
 *   responsiveMs       two-frame latency measured right after the storm. BEFORE:
 *                      balloons under main-thread starvation. AFTER: ~frame time.
 *   alive              plot still mounted with drawn paths + body connected.
 *
 * PASS = alive:true, low responsiveMs, clampTailCommits ~0, clampTailPrevented ~0.
 * Real-Safari confirmation is the user's 30-second post-merge check (flagged in PR).
 */
(function () {
  function findPlot() {
    const bg = document.querySelector("svg [data-plot-bg]");
    if (bg) return bg.closest("svg");
    return document.querySelector("section svg") || document.querySelector("svg");
  }

  function wheelAt(el, deltaY, ctrlKey) {
    const r = el.getBoundingClientRect();
    const ev = new WheelEvent("wheel", {
      deltaY,
      deltaMode: 0,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      bubbles: true,
      cancelable: true,
      ctrlKey: !!ctrlKey,
    });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }

  const frame = () => new Promise((res) => requestAnimationFrame(() => res()));

  // A momentum-style burst: |deltaY| peaks then decays exponentially, several
  // events per animation frame (a real trackpad streams ~100/sec long after the
  // fingers stop). Returns how many events were preventDefault'd.
  async function burst(el, { dir, count, peak, decay, perFrame, ctrlKey }) {
    let prevented = 0;
    for (let i = 0; i < count; i++) {
      const mag = Math.max(1, peak * Math.exp(-decay * i));
      if (wheelAt(el, dir * mag, ctrlKey)) prevented++;
      if (perFrame && i % perFrame === perFrame - 1) await frame();
    }
    await frame();
    return prevented;
  }

  async function twoFrameLatency() {
    const t0 = performance.now();
    await frame();
    await frame();
    return performance.now() - t0;
  }

  window.runWheelStorm = async function runWheelStorm() {
    const el = findPlot();
    if (!el) return { error: "plot <svg> not found — open /ips or /platforms first" };

    const g = window;
    g.__STUDIO_PROFILE = true;
    g.__STUDIO_PROF = [];

    let commits = 0;
    const mo = new MutationObserver(() => { commits++; }); // one callback ≈ one commit
    // `d` catches line series; x/y/width/height catch grouped bars (abs-mode flow
    // series like platform total_volume). One React commit = one microtask =
    // one callback regardless of how many elements changed.
    mo.observe(el, { subtree: true, attributes: true, attributeFilter: ["d", "x", "y", "width", "height"] });

    const t0 = performance.now();

    // Phase A — violent mid-range flurry (default window): zoom in hard, then out.
    await burst(el, { dir: -1, count: 130, peak: 260, decay: 0.02, perFrame: 5 });
    await burst(el, { dir: +1, count: 130, peak: 260, decay: 0.02, perFrame: 5 });
    const phaseAcommits = commits;
    const phaseArebuilds = g.__STUDIO_PROF.length;

    // Phase B — AGAINST THE CLAMP: pin to full range, then a long zoom-out tail
    // (the "scrolling past the intended frame" case that kills the tab).
    await burst(el, { dir: +1, count: 60, peak: 600, decay: 0, perFrame: 3 }); // pin to full range
    const commitsBeforeTail = commits;
    const clampTailPrevented = await burst(el, { dir: +1, count: 300, peak: 400, decay: 0.006, perFrame: 3 });
    const clampTailCommits = commits - commitsBeforeTail;

    const wallMs = performance.now() - t0;
    mo.disconnect();

    const responsiveMs = await twoFrameLatency();
    const prof = g.__STUDIO_PROF || [];
    const avg = prof.length ? prof.reduce((a, b) => a + b, 0) / prof.length : 0;
    g.__STUDIO_PROFILE = false;

    const plot = findPlot();
    // Series render as lines (path) OR grouped bars (rect); >1 excludes the lone
    // static data-plot-bg rect, so this is true only if real series are still drawn.
    const alive = !!plot && plot.querySelectorAll("path, rect").length > 1 && document.body.isConnected;

    return {
      events: 130 + 130 + 60 + 300,
      commits,
      commitsPerSec: Math.round((commits / wallMs) * 1000),
      phaseAcommits,
      phaseArebuilds,
      rebuildMsAvg: +avg.toFixed(3),
      rebuildMsMax: +(prof.length ? Math.max.apply(null, prof) : 0).toFixed(3),
      rebuildCount: prof.length,
      clampTailCommits,       // BEFORE: ~one per frame of the tail. AFTER: ~0.
      clampTailPrevented,     // BEFORE: ~300 (page frozen). AFTER: ~0 (page scrolls).
      wallMs: Math.round(wallMs),
      responsiveMs: +responsiveMs.toFixed(1),
      alive,
    };
  };

  console.log("[wheel-storm] loaded — run:  await runWheelStorm()");
})();
