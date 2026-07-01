import type { ReactNode } from "react";
import type { PlatformRow } from "@/lib/types";
import { PLATFORM_COLOR } from "@/lib/platform/rollup";

/**
 * Platform structure strip for /platforms — concentration + the gacha lens,
 * mirroring CategoryStatBar. Deliberately NOT total 24h volume (that's the
 * homepage's quick answer); this is about market *structure*.
 */
function hhiLabel(hhi: number): string {
  if (hhi >= 0.4) return "High";
  if (hhi >= 0.25) return "Moderate";
  return "Low";
}

export function PlatformStatBar({ rows }: { rows: PlatformRow[] }) {
  const total = rows.reduce((s, p) => s + (Number.isFinite(p.total24Usd) ? p.total24Usd : 0), 0) || 1;
  const leading = rows.reduce<PlatformRow | null>((best, p) => (!best || p.total24Usd > best.total24Usd ? p : best), null);
  const gacha = rows.reduce((s, p) => s + (p.gachaVol24Usd ?? 0), 0);
  const gachaShare = (gacha / total) * 100;
  const hhi = rows.reduce((s, p) => s + Math.pow((p.total24Usd || 0) / total, 2), 0);
  const chains = new Set(rows.map((p) => p.chain)).size;

  return (
    <section className="mb-7 flex flex-wrap overflow-hidden rounded-xl border border-line">
      <Stat
        label="Platforms"
        value={
          <span>
            <span className="tabular">{rows.length}</span>{" "}
            <span className="text-[12px] text-ink-3">· {chains} chains</span>
          </span>
        }
      />
      <Stat
        label="Leading"
        value={
          leading ? (
            <span>
              {leading.name}{" "}
              <span className="tabular" style={{ color: PLATFORM_COLOR[leading.key] ?? "var(--color-ink-2)" }}>
                {Math.round((leading.total24Usd / total) * 100)}%
              </span>
            </span>
          ) : (
            "—"
          )
        }
      />
      <Stat
        label="Gacha share"
        value={
          Number.isFinite(gachaShare) ? (
            <span>
              <span className="tabular">{Math.round(gachaShare)}%</span>{" "}
              <span className="text-[12px] text-ink-3">of 24h vol</span>
            </span>
          ) : (
            "—"
          )
        }
      />
      <Stat
        label="Concentration"
        value={
          <span>
            {hhiLabel(hhi)} <span className="tabular text-[12px] text-ink-3">· HHI {hhi.toFixed(2)}</span>
          </span>
        }
      />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-[150px] flex-1 border-line px-4 py-3 [&:not(:last-child)]:border-r">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">{label}</div>
      <div className="text-[15px] font-semibold">{value}</div>
    </div>
  );
}
