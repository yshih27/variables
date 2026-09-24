import { StatCard, StatCardRow } from "../StatCard";
import type { VaultValuation } from "@/lib/data/vault";
import { formatCompactUsd, formatInt } from "@/lib/format";
import { basisCounts, venueSplit } from "@/lib/vault/view";

/**
 * The five figures a custodian's statement leads with — each one with its n.
 *
 * ⚠️ A TOTAL WITHOUT AN n IS NEVER PRINTED. Every card's foot says how many
 * slabs stand behind its figure; a card whose n is 0 prints "—" and says why,
 * never "$0" (nothing was valued, which is not the same as worthless).
 *
 * ⚠️ THE FLOOR IS ITS OWN CARD AND NEVER ENTERS THE VALUE. `atValue` is the
 * reference-or-last-sale total; `atFloor` is what plausible asks add up to over
 * the holdings that have one. The spread compares the two only over holdings
 * that have both, with that n in its foot.
 */
export function VaultKpis({ v }: { v: VaultValuation }) {
  const t = v.totals;
  const basis = basisCounts(v);
  const coverage = t.holdings ? (t.valued / t.holdings) * 100 : 0;
  const spread = t.spread;

  return (
    <StatCardRow cols={5}>
      <StatCard
        label="Holdings"
        value={formatInt(t.holdings)}
        sub={t.holdings ? venueSplit(v) : "no slabs from tracked venues"}
      />
      <StatCard
        label="Valued"
        // "n/N" — "n of N" at 48px wraps inside a fifth of the row.
        value={t.holdings ? `${formatInt(t.valued)}/${formatInt(t.holdings)}` : "—"}
        sub={
          t.holdings
            ? `${formatInt(t.valued)} of ${formatInt(t.holdings)} slabs · ${coverage.toFixed(0)}% coverage · ${formatInt(t.keyed)} keyed`
            : "nothing to value"
        }
      />
      <StatCard
        label="Value"
        value={t.atValue.n ? formatCompactUsd(t.atValue.usd) : "—"}
        accent={t.atValue.n > 0}
        sub={
          t.atValue.n
            ? `reference ${formatInt(basis.reference)} · last sale ${formatInt(basis.lastSale)}`
            : "no slab has a reference price or a sale"
        }
      />
      <StatCard
        label="At floor"
        value={t.atFloor.n ? formatCompactUsd(t.atFloor.usd) : "—"}
        sub={
          t.atFloor.n
            ? `${formatInt(t.atFloor.n)} plausible ask${t.atFloor.n === 1 ? "" : "s"} · never in the value`
            : "no plausible ask on any slab"
        }
      />
      {/* Five cards on a two-up (phone) or three-up (sm) grid leave a hole in
          the last row; Spread takes it, so the strip closes flush at every width. */}
      <StatCard
        className="col-span-2 lg:col-span-1"
        label="Spread"
        value={spread ? `${spread.usd >= 0 ? "+" : "−"}${formatCompactUsd(Math.abs(spread.usd))}` : "—"}
        tone={spread ? spread.usd : null}
        deltaPct={spread ? spread.pct : null}
        sub={
          spread
            ? `floor vs reference · over ${formatInt(spread.n)} with both`
            : "no holding has both a price and a floor"
        }
      />
    </StatCardRow>
  );
}
