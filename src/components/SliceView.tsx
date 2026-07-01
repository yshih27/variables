import type { ReactNode } from "react";
import { NavBar } from "@/components/NavBar";
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
export function SliceView({ slice, children }: { slice: SliceDescriptor; children: ReactNode }) {
  return (
    <>
      <NavBar />
      <div className="px-7">
        <div className="grid grid-cols-1 min-[860px]:grid-cols-[280px_1fr] min-[860px]:h-[calc(100vh-65px)] min-[860px]:overflow-hidden">
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
