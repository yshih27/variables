import type { Chain } from "@/lib/types";

type Props = {
  chains: Chain[];
  active?: "All" | Chain;
};

const DOT: Record<Chain, string> = {
  Polygon: "var(--color-purple)",
  Solana: "var(--color-solana)",
  Base: "var(--color-blue)",
  Ethereum: "#9aa6ff",
};

/**
 * Visual-only chain filter. Until the per-chain filter logic ships
 * client-side, the buttons are styled as disabled with a "coming soon"
 * hover tooltip so users don't try to interact with dead UI.
 *
 * To enable real filtering: convert to `"use client"`, accept an
 * `onChange` prop, and have the parent IP / Platform table filter
 * its rows by chain.
 */
export function ChainFilter({ chains, active = "All" }: Props) {
  const items: Array<{ key: "All" | Chain; label: string; dot?: string }> = [
    { key: "All", label: "All" },
    ...chains.map((c) => ({ key: c, label: c, dot: DOT[c] })),
  ];
  return (
    <div className="mb-9 flex items-center gap-1" title="Per-chain filtering coming soon">
      {items.map((it) => {
        const isActive = it.key === active;
        return (
          <span
            key={it.key}
            aria-disabled
            className={`inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] transition-colors ${
              isActive
                ? "bg-bg-2 text-ink"
                : "cursor-not-allowed text-ink-4 opacity-60"
            }`}
            title={isActive ? "Currently showing all chains" : "Per-chain filtering coming soon"}
          >
            {it.dot && (
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: it.dot }}
              />
            )}
            {it.label}
          </span>
        );
      })}
    </div>
  );
}
