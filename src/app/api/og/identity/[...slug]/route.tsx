import { getIdentityDetail } from "@/lib/data/identityDetail";
import { formatCompactUsd } from "@/lib/format";
import { renderOgCard } from "@/lib/og/ogCard";
import { identityDisplayName } from "@/lib/card/identity";
import { latestCompleteMonthly } from "@/lib/card/identityView";

/**
 * GET /api/og/identity/<slug> — the identity page's share image.
 *
 * ⚠️ A ROUTE HANDLER, NOT `opengraph-image.tsx`. Next's image file convention
 * cannot sit under a catch-all segment ("Catch-all must be the last part of the
 * URL"), so the identity page points `openGraph.images` here instead. Same
 * template as every other share card (`renderOgCard`), Node runtime because the
 * reader reads DB snapshots, cached an hour like the others.
 */
export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  const path = (slug ?? []).map((p) => decodeURIComponent(p)).join("/");
  const detail = path ? await getIdentityDetail(path).catch(() => null) : null;

  if (!detail) {
    return renderOgCard({ eyebrow: "Tokenized Collectibles", title: "VARIBLE" });
  }

  const p = detail.parts;
  // Headline: the latest COMPLETE monthly price > the last sale > the slab
  // count. ⚠️ Never the running month — provisional numbers stay off the card.
  const monthly = latestCompleteMonthly(detail.monthly);
  const last = detail.sales.at(-1) ?? null;
  const stat = monthly
    ? { value: formatCompactUsd(monthly.value), label: "Monthly price" }
    : last
      ? { value: formatCompactUsd(last.priceUsd), label: "Last sale" }
      : { value: String(detail.tokens.length), label: detail.tokens.length === 1 ? "Slab tracked" : "Slabs tracked" };

  return renderOgCard({
    eyebrow: [p.ipName, p.setName, p.number ? `#${p.number}` : null].filter(Boolean).join(" · "),
    title: `${identityDisplayName(p.name)} · ${p.grade}`,
    stat,
    substat: monthly || last ? { value: `${detail.tokens.length} slab${detail.tokens.length === 1 ? "" : "s"}`, label: "" } : undefined,
  });
}
