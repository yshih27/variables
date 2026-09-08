"use client";

import { useEffect, useState } from "react";
import { readRailPref, subscribeRailPref, applyRailPref, notifyRailPref, type RailPref } from "./railPref";

/**
 * The rail's open/icons state, shared by every control that can change it.
 *
 * ⚠️ READ AFTER MOUNT, never during render: the server has no DOM and no storage,
 * so a lazy initial read would be a hydration mismatch. The paint is already
 * correct before this runs — the pre-hydration script set `data-rail` — so this
 * only brings React's copy in line for the controls' labels.
 */
export function useRailPref(): [RailPref, (next: RailPref) => void] {
  const [pref, setPref] = useState<RailPref>("open");

  useEffect(() => {
    const sync = () => setPref(readRailPref());
    sync();
    // The viewport is half the input (see stampEffectiveRailPref), so a resize
    // across 1280 has to re-derive the mode — otherwise a rail dragged narrow
    // keeps rendering expanded rows in a 56px column.
    const onResize = () => notifyRailPref();
    window.addEventListener("resize", onResize);
    const off = subscribeRailPref(sync);
    return () => {
      window.removeEventListener("resize", onResize);
      off();
    };
  }, []);

  return [pref, applyRailPref];
}
