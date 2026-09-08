import { buildStatsBoard } from "@/lib/data/statsBoard";
import { formatCompactUsd } from "@/lib/format";
import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/ogCard";

// Share image for /stats. Node runtime — reads the cached snapshot board.
export const runtime = "nodejs";
export const revalidate = 3600;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "VARIBLE Market Stats";

export default async function Image() {
  const board = await buildStatsBoard().catch(() => null);
  const total =
    board && Number.isFinite(board.kpis.gacha30d) && Number.isFinite(board.kpis.resale30d)
      ? board.kpis.gacha30d + board.kpis.resale30d
      : NaN;

  return renderOgCard({
    eyebrow: "Market stats",
    title: "The market, in citable numbers",
    // ⚠️ The card carries the WINDOW, not a bare figure — an OG image is the most
    // quotable artefact the site produces and the least able to be asked a
    // follow-up question.
    stat: Number.isFinite(total)
      ? { value: formatCompactUsd(total), label: "turnover · 30 complete days" }
      : undefined,
  });
}
