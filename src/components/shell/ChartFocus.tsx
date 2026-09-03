"use client";

import { createContext, useCallback, useContext, useMemo, useRef } from "react";

/**
 * Which chart the `[` / `]` window shortcuts act on (SHELL_V2 S3).
 *
 * ⚠️ THE POINT IS THAT THEY TARGET ONE CHART, NEVER ALL OF THEM. /ips carries a
 * studio plus three MetricBarCards, each with its own D|W|M and its own persisted
 * surface (P1-B); a global "[" that cycled every chart would rewrite three stored
 * preferences the reader never touched. Charts register a `cycle` callback and
 * claim focus on hover or keyboard focus; the shortcut calls exactly one.
 *
 * The default value is a no-op, so a chart rendered OUTSIDE the shell (the flag
 * off, or a page that never mounts the provider) behaves exactly as it did before
 * — no provider required, no crash.
 */
type Cycle = (dir: 1 | -1) => void;

type ChartFocusApi = {
  register: (id: string, cycle: Cycle) => () => void;
  claim: (id: string) => void;
  release: (id: string) => void;
  cycleActive: (dir: 1 | -1) => boolean;
};

const NOOP: ChartFocusApi = {
  register: () => () => {},
  claim: () => {},
  release: () => {},
  cycleActive: () => false,
};

const Ctx = createContext<ChartFocusApi>(NOOP);

export function useChartFocus(): ChartFocusApi {
  return useContext(Ctx);
}

export function ChartFocusProvider({ children }: { children: React.ReactNode }) {
  const registry = useRef(new Map<string, Cycle>());
  // ⚠️ A REF, NOT STATE. The active chart id is never rendered — it is read
  // imperatively by the key handler — so holding it in state would re-render the
  // whole subtree on every hover across a page of charts, for nothing.
  const activeRef = useRef<string | null>(null);

  const register = useCallback((id: string, cycle: Cycle) => {
    registry.current.set(id, cycle);
    return () => {
      registry.current.delete(id);
    };
  }, []);

  const claim = useCallback((id: string) => {
    activeRef.current = id;
  }, []);
  // Only the chart that HOLDS focus may release it: leaving card A after entering
  // card B must not clear B (mouseleave/mouseenter can arrive in either order).
  const release = useCallback((id: string) => {
    if (activeRef.current === id) activeRef.current = null;
  }, []);

  const cycleActive = useCallback((dir: 1 | -1) => {
    const id = activeRef.current;
    if (!id) return false;
    const fn = registry.current.get(id);
    if (!fn) return false;
    fn(dir);
    return true;
  }, []);

  const value = useMemo<ChartFocusApi>(
    () => ({ register, claim, release, cycleActive }),
    [register, claim, release, cycleActive],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Props a chart spreads onto its root so hover / focus claims the shortcut. */
export function chartFocusProps(api: ChartFocusApi, id: string) {
  return {
    onMouseEnter: () => api.claim(id),
    onMouseLeave: () => api.release(id),
    onFocusCapture: () => api.claim(id),
  };
}
