/**
 * Root loading state shown while a Server Component data fetch is in flight.
 *
 * Renders a NavBar (so the chrome doesn't disappear) and a skeleton grid
 * that vaguely mirrors the homepage shape — feels like the page is loading,
 * not crashed. With our 30-60s cold-cache reality, this is the difference
 * between users staying and bouncing.
 */
import { NavBar } from "@/components/NavBar";

export default function RootLoading() {
  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[1760px] px-8 pt-10 pb-20">
        {/* Hero skeleton */}
        <div className="mb-12 flex flex-col gap-4">
          <div className="h-3 w-32 animate-pulse rounded-md bg-bg-2" />
          <div className="h-12 w-full max-w-[480px] animate-pulse rounded-md bg-bg-2" />
        </div>

        {/* Stat strip */}
        <div className="mb-12 grid grid-cols-2 gap-x-10 gap-y-7 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex min-w-0 flex-col gap-2">
              <div className="h-3 w-24 max-w-full animate-pulse rounded-md bg-bg-2" />
              <div className="h-8 w-28 max-w-full animate-pulse rounded-md bg-bg-2" />
              <div className="h-3 w-20 max-w-full animate-pulse rounded-md bg-bg-2" />
            </div>
          ))}
        </div>

        {/* Two-panel row */}
        <div className="mb-10 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.7fr]">
          <div className="h-[320px] animate-pulse rounded-2xl border border-line bg-bg-1" />
          <div className="h-[320px] animate-pulse rounded-2xl border border-line bg-bg-1" />
        </div>

        {/* Table skeleton */}
        <div className="mt-14 space-y-3">
          <div className="h-6 w-48 animate-pulse rounded-md bg-bg-2" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-bg-2/60" />
          ))}
        </div>

        <div className="mt-12 flex items-center justify-center gap-3 text-[12px] text-ink-3">
          <span className="live-dot" />
          <span>Fetching latest on-chain snapshot…</span>
        </div>
      </div>
    </>
  );
}
