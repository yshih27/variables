import { getCharacterDetail } from "@/lib/data/characterRollups";
import { formatCompactUsd } from "@/lib/format";
import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/ogCard";
import { latestIndex } from "@/lib/card/characterView";

// Per-character share image — the shared OG template, Node runtime like the
// others (the reader reads a DB snapshot).
export const runtime = "nodejs";
export const revalidate = 3600;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Character on VARIBLE";

export default async function Image({ params }: { params: Promise<{ key: string; character: string }> }) {
  const { key, character } = await params;
  const detail = await getCharacterDetail(key, decodeURIComponent(character)).catch(() => null);

  if (!detail) {
    return renderOgCard({ eyebrow: "Tokenized Collectibles", title: "VARIBLE" });
  }

  // Headline: the published index level when there is one, else 30d resale
  // volume. ⚠️ Never the running month — the index is complete months only and
  // the 30d figure is a closed window.
  const idx = latestIndex(detail.index);
  const stat = idx
    ? { value: idx.value.toFixed(1), label: `${detail.name} index` }
    : { value: detail.kpis.sales30d ? formatCompactUsd(detail.kpis.volume30d) : "—", label: "30d resale" };

  return renderOgCard({
    eyebrow: `${detail.ipName} · Character`,
    title: detail.name,
    stat,
    substat: { value: `${detail.identities.toLocaleString("en-US")} cards`, label: "" },
  });
}
