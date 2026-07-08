import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { CardDetailView } from "@/components/CardDetailView";
import { getCardDetail } from "@/lib/card/fetchCard";
import { getCardSales, type CardSalesHistory } from "@/lib/data/cardSales";

export const dynamic = "force-dynamic";

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
      <NavBar />
      <div className="mx-auto max-w-[1100px] px-8 pt-10 pb-20 font-sans">
        <CardDetailView card={card} salesHistory={salesHistory} />
        <div className="mt-20 text-center text-[12px] text-ink-3">
          VARIABLE · card detail
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
  if (!card) return { title: "Card not found · VARIABLE" };
  const bits = [card.traits.set, card.gradeLabel].filter(Boolean).join(" · ");
  return {
    title: `${card.name} · VARIABLE`,
    description: `${card.name}${bits ? ` — ${bits}` : ""} on ${card.platformLabel}.`,
  };
}
