import { getPlatformDetail } from "@/lib/data/fetchPlatform";
import { formatCompactUsd } from "@/lib/format";
import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/ogCard";

// Per-platform share image (F9-1). Node runtime — the reader reads DB snapshots.
export const runtime = "nodejs";
export const revalidate = 3600;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Platform overview on VARIABLE";

export default async function Image({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const pd = await getPlatformDetail(key).catch(() => null);

  if (!pd) {
    return renderOgCard({ eyebrow: "Tokenized Collectibles", title: "VARIABLE" });
  }

  const hasTotal = Number.isFinite(pd.total24Usd) && pd.total24Usd > 0;
  const hasMcap = Number.isFinite(pd.mcapUsd) && pd.mcapUsd > 0;

  return renderOgCard({
    eyebrow: `Platform · ${pd.chain}`,
    title: pd.source.name,
    stat: { value: hasTotal ? formatCompactUsd(pd.total24Usd) : "—", label: "24h total" },
    substat: hasMcap ? { value: formatCompactUsd(pd.mcapUsd), label: "market cap" } : undefined,
    spark: pd.spark24h,
  });
}
