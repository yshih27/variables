import type { PlatformDetail } from "@/lib/data/fetchPlatform";
import type { Chain } from "@/lib/types";
import { RailActions } from "./RailActions";
import { FreshnessChips } from "./FreshnessChip";

/**
 * Identity strip for /platform/[key] on the Overview system: who this platform
 * is, plus the actions and freshness that used to hang off the bottom of
 * PlatformRail's tall sidebar.
 *
 * The Overview layout is normal-flow (rail + chart + cards stacked down the
 * page), not SliceView's locked viewport-height two-column shell, so the rail's
 * identity block had nowhere to live. It moves here, one line high, and the
 * levels it used to carry are now the Overview's metric column. /ip/[key] still
 * uses SliceView + IPRail unchanged.
 *
 * Vault is "—" when unverified (Phygitals) — sources.ts carries `vault: null`
 * on purpose rather than guessing a provider.
 */
const CHAIN_DOT: Record<Chain, string> = {
  Polygon: "var(--color-purple)",
  Solana: "var(--color-solana)",
  Base: "var(--color-blue)",
  Ethereum: "#9aa6ff",
};

export function PlatformOverviewHeader({ detail }: { detail: PlatformDetail }) {
  return (
    <header className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="flex items-center gap-3">
        <span
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-none bg-bg-2 text-[15px] font-bold tracking-[0.04em]"
          aria-hidden
        >
          {detail.source.short}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] font-bold leading-none tracking-[-0.02em]">
              {detail.source.name}
            </h1>
            <span className="rounded-md border border-yellow/30 bg-yellow/10 px-[7px] py-0.5 font-mono text-[11.5px] font-semibold text-yellow">
              #{detail.rank}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-none"
                style={{ background: CHAIN_DOT[detail.chain] }}
              />
              {detail.chain}
            </span>
            <span aria-hidden>·</span>
            <span>
              Vault: <span className="text-ink-2">{detail.source.vault ?? "—"}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <FreshnessChips sources={["core-volume", "marketcap", "listings", "holders"]} />
        {/* RailActions' own `mt-auto pt-[22px]` is for the tall rail's bottom;
            neutralized here so the buttons sit on the header's baseline. */}
        <div className="w-[280px] max-w-full [&>div]:mt-0 [&>div]:pt-0">
          <RailActions name={detail.source.name} />
        </div>
      </div>
    </header>
  );
}
