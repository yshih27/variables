import { NavBar } from "@/components/NavBar";

/**
 * The statement while the chain is read. A first look at a wallet reads the
 * venues live (bounded at 20 s by the backend), so this says so rather than
 * pulsing a homepage-shaped grid: the shape is the statement's own — head, the
 * five-card strip, the pair, the table — and it holds no figure.
 */
export default function VaultLoading() {
  return (
    <>
      <NavBar tickerPlaceholder />
      <div className="px-4 pt-6 pb-20 font-sans sm:px-8" aria-busy="true">
        <div className="mb-3">
          <div className="h-3 w-12 animate-pulse rounded-md bg-bg-2" />
          <div className="mt-2.5 h-6 w-44 animate-pulse rounded-md bg-bg-2" />
          <p className="mt-3 font-mono text-[11.5px] text-ink-3" data-vault-loading>
            reading the chain · a first look at a wallet can take up to 20 s
          </p>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2.5 bg-bg-1 px-5 py-5">
                <div className="h-9 w-24 max-w-full animate-pulse rounded-md bg-bg-2" />
                <div className="h-3 w-16 animate-pulse rounded-md bg-bg-2" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="h-[260px] animate-pulse rounded-2xl border border-line bg-bg-1" />
            <div className="h-[260px] animate-pulse rounded-2xl border border-line bg-bg-1" />
          </div>
          <div className="h-[420px] animate-pulse rounded-2xl border border-line bg-bg-1" />
        </div>
      </div>
    </>
  );
}
