import { StatCard, StatCardRow } from "../StatCard";
import type { CharacterDetail } from "@/lib/data/characterRollups";
import { formatCompactUsd, formatInt } from "@/lib/format";
import { monthShort } from "@/lib/card/identityView";
import { indexGateText, indexMoM, latestIndex } from "@/lib/card/characterView";

/**
 * The four levels: 30d sales · 30d volume · share of the IP's resale · index.
 *
 * ⚠️ THE INDEX CARD IS "—" WITH THE REASON when the engine published nothing
 * (`indexGate`), never a level derived here. When it published, the value is
 * the latest complete month's level with its month named and the
 * month-over-month change beside it (only across adjacent months).
 *
 * ⚠️ THE SHARE CARRIES ITS CAVEAT. Both halves of the ratio are the same sale
 * panel, and a two-character card counts under both — so the sub says "not
 * additive across characters" rather than letting a reader sum a page of them.
 */
export function CharacterKpis({ detail }: { detail: CharacterDetail }) {
  const k = detail.kpis;
  const last = latestIndex(detail.index);
  const mom = indexMoM(detail.index);
  return (
    <StatCardRow cols={4}>
      <StatCard
        label="30d sales"
        value={formatInt(k.sales30d)}
        sub={k.sales30d ? `${detail.venues.length} venue${detail.venues.length === 1 ? "" : "s"} · every set and grade` : "no sale in the last 30 days"}
      />
      <StatCard
        label="30d volume"
        value={k.sales30d ? formatCompactUsd(k.volume30d) : "—"}
        sub="secondary sales, seller-received"
        accent={k.sales30d > 0}
      />
      <StatCard
        label={`Share of ${detail.ipName} resale`}
        value={k.sales30d ? `${k.shareOfIp30d.toFixed(1)}%` : "—"}
        sub="30d · same panel, not additive across characters"
      />
      <StatCard
        label="Index"
        value={last ? last.value.toFixed(1) : "—"}
        deltaPct={mom}
        deltaLabel={last && mom != null ? "1m" : undefined}
        sub={
          last
            ? `${monthShort(last.ts)} · ${last.n ?? 0} priced cards${last.thin ? " · thin month" : ""}`
            : indexGateText(detail.indexGate)
        }
      />
    </StatCardRow>
  );
}
