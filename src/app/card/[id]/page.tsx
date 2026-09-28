import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { CardDetailView } from "@/components/CardDetailView";
import { getCardDetail } from "@/lib/card/fetchCard";
import { getCardSales, type CardSalesHistory } from "@/lib/data/cardSales";

/**
 * ⚠️ ISR, NOT PER-REQUEST. Only `params` is read; the detail is one keyset row
 * plus the token's metadata and the sales come from a 30-minute
 * `unstable_cache`. A per-request render paid that row read and a full RSC
 * payload on every crawler hit of ~55K token URLs. With `revalidate` a card is
 * rendered once per 30 minutes and served by the CDN in between; the horizon
 * matches the sales reader's, so the page is never older than its own figures.
 * (See the identity page for the September 2026 usage-pause context.)
 */
export const revalidate = 1800;

// Required for `revalidate` to take effect on a dynamic segment: an empty list
// prerenders nothing and caches every path on first request. The full note is
// on src/app/i/[...slug]/page.tsx.
export async function generateStaticParams() {
  return [];
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const card = await getCardDetail(id);
  if (!card) notFound();

  // Per-token price history (F9-3) via the B9-4 reader — cached feeds, never
  // blocks the page (degrades to an empty history the chart renders honestly).
  const salesHistory = await getCardSales(card.platform, card.tokenId).catch(
    (): CardSalesHistory => ({ sales: [], windowDays: null, asOf: null, source: null }),
  );

  return (
    <>
      <NavBar ticker={await buildMarketTicker()} />
      <div className="mx-auto max-w-[1100px] px-8 pt-10 pb-20 font-sans">
        <CardDetailView card={card} salesHistory={salesHistory} />
        <div className="mt-20 text-center text-[12px] text-ink-3">
          VARIBLE · card detail
        </div>
      </div>
    </>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const card = await getCardDetail(id);
  if (!card) return { title: "Card not found · VARIBLE" };
  const bits = [card.traits.set, card.gradeLabel].filter(Boolean).join(" · ");
  return {
    title: `${card.name} · VARIBLE`,
    description: `${card.name}${bits ? ` — ${bits}` : ""} on ${card.platformLabel}.`,
  };
}
