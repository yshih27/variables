import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { CardDetailView } from "@/components/CardDetailView";
import { getCardDetail } from "@/lib/card/fetchCard";

export const dynamic = "force-dynamic";

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const card = await getCardDetail(id);
  if (!card) notFound();

  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[1100px] px-8 pt-10 pb-20">
        <CardDetailView card={card} />
        <div className="mt-20 text-center text-[12px] text-ink-3">
          TCG.market · card detail
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
  if (!card) return { title: "Card not found · TCG.market" };
  const bits = [card.traits.set, card.gradeLabel].filter(Boolean).join(" · ");
  return {
    title: `${card.name} · TCG.market`,
    description: `${card.name}${bits ? ` — ${bits}` : ""} on ${card.platformLabel}.`,
  };
}
