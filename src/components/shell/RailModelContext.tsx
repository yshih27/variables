"use client";

import { createContext, useContext } from "react";
import type { RailModel } from "@/lib/types";

/**
 * The rail model, made reachable by client leaves BELOW the page boundary.
 *
 * ⚠️ WHY A CONTEXT AND NOT A SECOND READ. AppShell already reads the rail model
 * once per window for the rail. The breadcrumb trail (nav r3) wants the same
 * names, and it renders INSIDE each page — a server component that does not
 * receive the model. Passing it down through context costs nothing and makes
 * "zero new reads" true by construction: a page cannot ask for the model
 * again, it can only consume the one already in the tree.
 *
 * Null when the flag-off shell is mounted (no AppShell); consumers fall back to
 * the static catalogs the model is itself built from.
 */
const RailModelContext = createContext<RailModel | null>(null);

export function RailModelProvider({ model, children }: { model: RailModel; children: React.ReactNode }) {
  return <RailModelContext.Provider value={model}>{children}</RailModelContext.Provider>;
}

export function useRailModel(): RailModel | null {
  return useContext(RailModelContext);
}
