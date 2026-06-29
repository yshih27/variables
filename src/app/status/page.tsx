import { NavBar } from "@/components/NavBar";
import { allChips, type ChipModel } from "@/lib/data/freshnessView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Data status · VARIABLE",
  description: "Honest, per-source freshness for every feed the site reads.",
};

const STATE_LABEL: Record<ChipModel["state"], string> = {
  ok: "OK",
  stale: "Stale",
  error: "Error",
  untracked: "Not tracked",
};
const STATE_DOT: Record<ChipModel["state"], string> = {
  ok: "bg-green",
  stale: "bg-yellow",
  error: "bg-red",
  untracked: "bg-ink-4",
};
const STATE_TEXT: Record<ChipModel["state"], string> = {
  ok: "text-green",
  stale: "text-yellow",
  error: "text-red",
  untracked: "text-ink-4",
};

function ageLabel(ms: number | null): string {
  if (ms == null) return "—";
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default async function StatusPage() {
  const chips = await allChips();
  const counts = chips.reduce(
    (acc, c) => ((acc[c.state] += 1), acc),
    { ok: 0, stale: 0, error: 0, untracked: 0 } as Record<ChipModel["state"], number>,
  );

  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[900px] px-8 pt-10 pb-20 font-sans">
        <h1 className="text-[28px] font-bold tracking-[-0.01em]">Data status</h1>
        <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-ink-2">
          Every feed the site reads, with the last time each source actually
          succeeded. &quot;As of&quot; is source-success time — not when a page
          was rendered. &quot;Not tracked&quot; means we don&apos;t have that
          data for that platform yet, rather than showing a number we don&apos;t
          trust.
        </p>

        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[12px]">
          <span className={STATE_TEXT.ok}>{counts.ok} ok</span>
          <span className={STATE_TEXT.stale}>{counts.stale} stale</span>
          <span className={STATE_TEXT.error}>{counts.error} error</span>
          <span className={STATE_TEXT.untracked}>{counts.untracked} not tracked</span>
        </div>

        <div className="mt-6 overflow-hidden rounded-lg border border-bg-3">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-bg-3 text-left text-[11px] uppercase tracking-[0.06em] text-ink-3">
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">State</th>
                <th className="px-4 py-2.5 font-medium">As of</th>
                <th className="px-4 py-2.5 text-right font-medium">Rows</th>
              </tr>
            </thead>
            <tbody>
              {chips.map((c) => (
                <tr key={c.source} className="border-b border-bg-2 last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="text-ink">{c.label}</span>
                    <span className="ml-2 font-mono text-[11px] text-ink-4">{c.source}</span>
                    {c.error && (
                      <div className="mt-0.5 max-w-[420px] truncate text-[11px] text-red" title={c.error}>
                        {c.error}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 ${STATE_TEXT[c.state]}`}>
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${STATE_DOT[c.state]}`} />
                      {STATE_LABEL[c.state]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-ink-2 tabular">{ageLabel(c.ageMs)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-2 tabular">
                    {c.rowsWritten != null ? c.rowsWritten.toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-20 text-center text-[12px] text-ink-3">
          VARIABLE · data provenance
        </div>
      </div>
    </>
  );
}
