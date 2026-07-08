import { readWeeklyReport } from "@/lib/data/weeklyReport";
import { formatPct } from "@/lib/format";
import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/ogCard";

// Share image for the weekly report (F9-2). Node runtime — reads the DB snapshot.
export const runtime = "nodejs";
export const revalidate = 3600;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "VARIABLE Weekly Report";

export default async function Image() {
  const report = await readWeeklyReport().catch(() => null);

  if (!report) {
    return renderOgCard({ eyebrow: "The market, weekly", title: "Weekly Report" });
  }

  const wow = report.index.wowPct;
  return renderOgCard({
    eyebrow: "Weekly Report",
    title: "The market, this week",
    stat: wow != null ? { value: formatPct(wow), label: "Index · week over week" } : undefined,
  });
}
