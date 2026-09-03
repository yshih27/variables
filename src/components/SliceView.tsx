import type { CSSProperties, ReactNode } from "react";
import { NavBar, TICKER_H, type TickerItem } from "@/components/NavBar";
import { IPActivityChart, type ActivityMetric } from "@/components/IPActivityChart";

/**
 * Descriptor for a deep-dive "slice" (IP / Platform / future chain): the static
 * left rail and the Activity-chart metrics that sit at the top of the scroll
 * column. Everything below the chart is the slice's own body, passed as children.
 */
export type SliceDescriptor = {
  rail: ReactNode;
  activity: ActivityMetric[];
};

/**
 * Shared shell for the IP & platform deep-dive pages (F1): NavBar + a desktop
 * viewport-height layout with a static rail and a single scrolling column — the
 * rail never scrolls, the right column is the only scroll area, mobile is normal
 * flow. The rail + Activity chart are the consistent top; the body differs per
 * slice and arrives as children. IP/Platform pages are thin wrappers over this,
 * and chain pages (F4) reuse it unchanged via getChainDetail.
 */
export function SliceView({
  slice,
  ticker,
  children,
}: {
  slice: SliceDescriptor;
  /** Market context strip (P1-C). The shell owns the NavBar, so it rides through here. */
  ticker?: TickerItem[];
  children: ReactNode;
}) {
  // The desktop pane is sized to the viewport MINUS the chrome above it. The context
  // strip adds a whole TICKER_H band to that chrome, so without this the pane would
  // overflow the space it has by exactly one band. TICKER_H is imported rather than
  // written out so the two can't drift apart.
  const chromeH = 65 + (ticker && ticker.length > 0 ? TICKER_H : 0);
  return (
    <>
      <NavBar ticker={ticker} />
      <div className="px-7">
        <div
          className="grid grid-cols-1 min-[860px]:grid-cols-[280px_1fr] min-[860px]:overflow-hidden min-[860px]:h-[var(--slice-h)]"
          style={{ "--slice-h": `calc(100vh - ${chromeH}px)` } as CSSProperties}
        >
          {slice.rail}
          {/* Right column — the only scroll area on desktop. */}
          <main className="scroll-y min-w-0 pb-24 pt-7 min-[860px]:h-full min-[860px]:min-h-0 min-[860px]:overflow-y-auto min-[860px]:pl-9">
            <IPActivityChart metrics={slice.activity} />
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
