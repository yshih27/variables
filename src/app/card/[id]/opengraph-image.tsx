import { getCardDetail, getCardMarket } from "@/lib/card/fetchCard";
import { formatCompactUsd } from "@/lib/format";
import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/ogCard";

// Per-card share image (F9-1). Node runtime — the readers read DB snapshots.
export const runtime = "nodejs";
export const revalidate = 3600;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Card detail on VARIBLE";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [card, market] = await Promise.all([
    getCardDetail(id).catch(() => null),
    getCardMarket(id).catch(() => null),
  ]);

  if (!card) {
    return renderOgCard({ eyebrow: "Tokenized Collectibles", title: "VARIBLE" });
  }

  // Headline: last sale > cheapest listing > the grade (there's always a grade).
  const stat =
    market?.lastSaleUsd != null
      ? { value: formatCompactUsd(market.lastSaleUsd), label: "Last sale" }
      : market?.listing != null
        ? { value: formatCompactUsd(market.listing.priceUsd), label: "Listed" }
        : { value: card.gradeLabel, label: "Grade" };

  return renderOgCard({
    eyebrow: `${card.platformLabel} · Card`,
    title: card.name,
    stat,
    substat:
      market?.lastSaleUsd != null || market?.listing != null
        ? { value: card.gradeLabel, label: "" }
        : undefined,
  });
}
