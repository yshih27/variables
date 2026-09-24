import Link from "next/link";
import { Section } from "../Section";
import { GradeChip } from "../GradeChip";
import type { VaultGroup } from "@/lib/data/vault";
import { IP_CATALOG } from "@/lib/data/ipCatalog";
import { formatCompactUsd, formatInt } from "@/lib/format";

/**
 * One side of the §7 pair — By IP ‖ By grade: where the vault's value sits.
 *
 * Rows are the backend's groups on the `atValue` basis (reference-or-last-sale),
 * already sorted by value: the label, how many slabs and how many of them are
 * valued, the value, and its share of the vault's value as a bar. A group whose
 * slabs have no value yet is still a row — its count is real — printed "—".
 *
 * ⚠️ THE SHARE IS OF VALUE, NOT OF SLABS. Its denominator is `atValue.usd`, the
 * same figure the Value card prints, so the shares of a list add to 100% of the
 * headline rather than to some other total.
 *
 * `fill` + a bottom-anchored note, so the pair's frames share both edges.
 */
const TOP = 8;

export function VaultSplit({
  kind,
  groups,
  totalUsd,
}: {
  kind: "ip" | "grade";
  groups: VaultGroup[];
  /** `totals.atValue.usd` — the headline the shares are of. */
  totalUsd: number;
}) {
  const shown = groups.slice(0, TOP);
  const rest = groups.slice(TOP);
  const restUsd = rest.reduce((a, g) => a + g.usd, 0);
  const restHoldings = rest.reduce((a, g) => a + g.holdings, 0);
  const title = kind === "ip" ? "By IP" : "By grade";

  return (
    <Section
      title={title}
      readMe={kind === "ip" ? "which IPs the vault's value sits in" : "which grades the vault's value sits in"}
      fill
      flush
    >
      <div className="flex min-h-0 flex-1 flex-col" data-vault-split={kind}>
        {shown.length ? (
          <ul className="divide-y divide-line/60">
            {shown.map((g) => {
              const share = totalUsd > 0 ? (g.usd / totalUsd) * 100 : 0;
              return (
                <li key={g.key} className="px-4 py-2 sm:px-5">
                  <div className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <Label kind={kind} g={g} />
                      <span className="shrink-0 font-mono text-[10.5px] text-ink-4">
                        {formatInt(g.holdings)} slab{g.holdings === 1 ? "" : "s"}
                        {g.valued < g.holdings ? ` · ${formatInt(g.valued)} valued` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-3">
                      <span className="tabular text-ink-2">{g.valued ? formatCompactUsd(g.usd) : "—"}</span>
                      {g.valued ? <span className="tabular"> · {share.toFixed(share < 10 ? 1 : 0)}%</span> : null}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-none bg-bg-2">
                    <div className="h-full bg-yellow" style={{ width: `${share}%`, opacity: 0.85 }} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-2.5 font-mono text-[11px] text-ink-4 sm:px-5">no slabs to split</p>
        )}
        {rest.length > 0 && (
          <p className="px-4 py-2 font-mono text-[11px] text-ink-4 sm:px-5">
            +{formatInt(rest.length)} more · {formatInt(restHoldings)} slab{restHoldings === 1 ? "" : "s"} ·{" "}
            {restUsd > 0 ? formatCompactUsd(restUsd) : "—"}
          </p>
        )}
        <p className="mt-auto border-t border-line px-4 py-2.5 font-mono text-[10.5px] text-ink-4 sm:px-5">
          value = reference price, else last sale · share of the vault&apos;s value
        </p>
      </div>
    </Section>
  );
}

function Label({ kind, g }: { kind: "ip" | "grade"; g: VaultGroup }) {
  if (kind === "grade") {
    return g.key === "-" ? <span className="font-mono text-[11.5px] text-ink-3">{g.label}</span> : <GradeChip label={g.label} />;
  }
  // An IP the catalog knows links to its page; anything else is named, not linked.
  const known = IP_CATALOG.some((i) => i.key === g.key);
  return known ? (
    <Link href={`/ip/${g.key}`} className="min-w-0 truncate text-ink transition-colors hover:text-yellow">
      {g.label}
    </Link>
  ) : (
    <span className="min-w-0 truncate font-mono text-[11.5px] text-ink-3">{g.label}</span>
  );
}
