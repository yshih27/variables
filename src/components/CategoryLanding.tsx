"use client";

import { useEffect, useState } from "react";
import { CATEGORY_ANCHORS, LANDING_MS } from "@/lib/shell/categoryAnchors";

/**
 * `/ips#<category>` — the landing (nav r3, item 2).
 *
 * A category row in the rail links to its own anchor rather than the bare
 * overview, and this is the other half of that promise: on arrival (and on any
 * later hash change — the rail is client-side, so clicking "Sports" from TCG is
 * a hash change, not a load), scroll the treemap into view and pulse every
 * treemap tile, mobile bar and table row of that category for ~1.2s.
 *
 * ⚠️ NOTHING HERE READS DATA. The elements already carry `data-category` from
 * the same `categoryOf` the rail model used; this only finds them. It renders no
 * DOM of its own — the anchor targets are `id`s the page already places — so it
 * costs the page no height.
 *
 * ⚠️ THE HIGHLIGHT IS THE HOUSE RING, NOT A NEW COLOUR: `.landing-hl` in
 * globals.css is `ring-yellow/60` with a fade, the same ring a focused control
 * gets. Removed on a timer so it never becomes a persistent state that would
 * need its own explanation.
 */
export function CategoryLanding() {
  /**
   * ⚠️ THE HASH IS CAPTURED AT RENDER, NOT IN THE EFFECT. Two things race the
   * effect: the Index Studio below rewrites the fragment with its own state as
   * soon as it has loaded, and React's dev StrictMode mounts every effect twice
   * — the first pass saw `#sports`, its scheduled work was cancelled by the
   * strict cleanup, the studio wrote in between, and the second pass saw only
   * `#m=…&sc=market`. A lazy state initializer runs during the client render,
   * before any effect of any sibling, so it sees the fragment the reader
   * arrived with. It renders nothing, so the server/client difference ("" vs
   * "#sports") is never a hydration mismatch.
   */
  const [arrivedWith] = useState(() => (typeof window === "undefined" ? "" : window.location.hash));

  useEffect(() => {
    const apply = (cat: string) => {
      const targets = document.querySelectorAll<HTMLElement>(`[data-category="${cat}"]`);
      if (!targets.length) return;
      const first = targets[0];
      (first.closest("section") ?? first).scrollIntoView({ block: "start", behavior: "smooth" });
      for (const el of targets) el.classList.add("landing-hl");
      window.setTimeout(() => {
        for (const el of document.querySelectorAll<HTMLElement>(".landing-hl")) el.classList.remove("landing-hl");
      }, LANDING_MS);
    };
    const run = (hash: string) => {
      const cat = hash.replace(/^#/, "");
      if (!(CATEGORY_ANCHORS as readonly string[]).includes(cat)) return;
      // After the treemap has measured and laid its tiles: a frame, then once
      // more for a slow layout. Idempotent, so a double run costs nothing; and
      // deliberately NOT cancelled on cleanup, or StrictMode's rehearsal unmount
      // would throw the real page's landing away.
      window.requestAnimationFrame(() => apply(cat));
      window.setTimeout(() => apply(cat), 350);
    };

    run(arrivedWith);
    // Later in-page moves — "Sports" clicked from "TCG" is a hash change, not a
    // load. The studio writes its state with replaceState, which does not fire
    // this, so it cannot clobber a landing in flight.
    const onHash = () => run(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [arrivedWith]);
  return null;
}
