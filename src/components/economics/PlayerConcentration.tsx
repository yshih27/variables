import type { EconomicsPlatform } from "@/lib/types";
import { Section } from "../Section";
import { MetricInfo } from "../MetricInfo";

/**
 * Who the spend comes from — top-1% share and the spend tiers.
 *
 * A DIFFERENT QUESTION from the ratio trend beside it (terminal-ux-study §3):
 * that one asks "is the platform paying out more than it takes in", this one asks
 * "how few people is the money coming from". They may share a row.
 *
 * ⚠️ `pctUsers` / `pctRevenue` / `top1PctShare` are ALREADY 0–100 from the
 * backend. Never ×100 — the opposite hazard to mcapPct24h, and the reason both
 * are stated here rather than left to the reader of the call site.
 */
export function PlayerConcentration({ platforms }: { platforms: EconomicsPlatform[] }) {
  const covered = platforms.filter((p) => p.players != null);

  return (
    <Section
      title="Who is spending"
      readMe="how concentrated each platform's pull spend is"
      subtitle="Share of all-time spend held by the top 1% of wallets"
      fill
    >
      {covered.length === 0 ? (
        <p className="text-[12.5px] text-ink-3">
          No platform is covered by player analytics yet.
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {covered.map((p) => (
            <div key={p.key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-ink">{p.name}</span>
                <span className="tabular text-[15px] font-bold text-ink">
                  {p.players!.top1PctSharePct.toFixed(1)}%
                  <span className="ml-1.5 text-[10.5px] font-normal text-ink-4">top 1%</span>
                </span>
              </div>
              {/* Tier bars: what share of REVENUE each spend tier accounts for,
                  against what share of USERS it is. The gap between the two is
                  the concentration story. */}
              <div className="mt-1.5 space-y-1">
                {p.players!.tiers
                  .filter((t) => t.pctRevenue > 0 || t.pctUsers > 0)
                  .map((t) => (
                    <div key={t.label} className="flex items-center gap-2 text-[10.5px]">
                      <span className="w-[74px] shrink-0 truncate font-mono text-ink-4">{t.label}</span>
                      <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-none bg-bg-2">
                        <span
                          className="absolute inset-y-0 left-0 bg-yellow/70"
                          style={{ width: `${Math.min(100, t.pctRevenue)}%` }}
                          title={`${t.pctRevenue.toFixed(1)}% of revenue`}
                        />
                      </span>
                      <span className="w-[86px] shrink-0 text-right tabular text-ink-3">
                        {t.pctRevenue.toFixed(1)}% rev
                      </span>
                      <span className="hidden w-[74px] shrink-0 text-right tabular text-ink-4 sm:inline">
                        {t.pctUsers.toFixed(1)}% users
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
          <p className="mt-auto pt-1 text-[10.5px] text-ink-4">
            From row-level pulls, all-time.{" "}
            <MetricInfo metric="spendConcentration" />
          </p>
        </div>
      )}
    </Section>
  );
}
