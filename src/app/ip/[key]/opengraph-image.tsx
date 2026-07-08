import { fetchIP } from "@/lib/data/fetchIP";
import { formatCompactUsd } from "@/lib/format";
import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/ogCard";

// Per-IP share image (F9-1). Node runtime — fetchIP reads the DB-backed snapshots.
export const runtime = "nodejs";
export const revalidate = 3600;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "IP market overview on VARIABLE";

export default async function Image({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const ip = await fetchIP(key).catch(() => null);

  if (!ip) {
    return renderOgCard({ eyebrow: "Tokenized Collectibles", title: "VARIABLE" });
  }

  const mcap = ip.totalMcapUsd;
  const hasMcap = Number.isFinite(mcap) && mcap > 0;
  const hasVol = Number.isFinite(ip.vol24Usd) && ip.vol24Usd > 0;

  return renderOgCard({
    eyebrow: `IP · Rank #${ip.rank}`,
    title: ip.ip.name,
    stat: hasMcap
      ? { value: formatCompactUsd(mcap), label: "Market cap" }
      : { value: hasVol ? formatCompactUsd(ip.vol24Usd) : "—", label: "24h volume" },
    substat: hasMcap && hasVol ? { value: formatCompactUsd(ip.vol24Usd), label: "24h vol" } : undefined,
    spark: ip.spark24h,
    accent: ip.ip.color,
  });
}
