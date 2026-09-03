import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { CardDetailView } from "@/components/CardDetailView";
import { getCardDetail } from "@/lib/card/fetchCard";
import { getCardSales, type CardSalesHistory } from "@/lib/data/cardSales";
import { getOraclePrice, readOracleBundle } from "@/lib/ripfun/oracleStore";

/**
 * The two oracle snapshots, read once per hour rather than once per card view.
 * They are whole-catalogue blobs — every card page would otherwise re-read both
 * on every request to answer one lookup.
 */
const getOracleBundle = unstable_cache(async () => readOracleBundle(), ["card-oracle-bundle:v1"], {
  revalidate: 3600,
  tags: ["ripfun-oracle"],
});

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

  // The CardOS comp for THIS printing at THIS grade. Null is the common case and
  // is rendered as nothing at all — see CardDetailView. The grade is passed so a
  // graded card gets its own rung or nothing; the reader never substitutes the raw
  // price for an unpriced grade.
  const comp = card.printingKey
    ? getOraclePrice(await getOracleBundle(), card.printingKey, card.gradeLabel)
    : null;

  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[1100px] px-8 pt-10 pb-20 font-sans">
        <CardDetailView card={card} salesHistory={salesHistory} comp={comp} />
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
