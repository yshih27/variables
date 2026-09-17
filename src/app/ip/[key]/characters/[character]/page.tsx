import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { getCharacterDetail } from "@/lib/data/characterRollups";
import { CharacterHeader } from "@/components/characters/CharacterHeader";
import { CharacterKpis } from "@/components/characters/CharacterKpis";
import { CharacterHero } from "@/components/characters/CharacterHero";
import { CharacterBySet } from "@/components/characters/CharacterBySet";
import { CharacterWhereItTrades } from "@/components/characters/CharacterWhereItTrades";
import { CharacterCardsTable } from "@/components/characters/CharacterCardsTable";

/**
 * /ip/[key]/characters/[character] — one CHARACTER across every set, grade
 * and venue: the rollup of its identity pages (block 2 of the identity-depth
 * design). The venue page's skeleton: header → KPI strip → ONE hero → one
 * side pair of different questions (§7) → the cards table.
 *
 * One read — `getCharacterDetail` (the character-rollups snapshot, cached 30
 * min). `notFound()` for a character the reader does not know; a malformed
 * path never reaches here (proxy.ts rewrites it to a real 404).
 */
export const revalidate = 1800;

export default async function CharacterPage({ params }: { params: Promise<{ key: string; character: string }> }) {
  const { key, character } = await params;
  const [detail, ticker] = await Promise.all([getCharacterDetail(key, decodeURIComponent(character)), buildMarketTicker()]);
  if (!detail) notFound();

  return (
    <>
      <NavBar ticker={ticker} />
      <div className="px-8 pt-6 pb-20 font-sans">
        <CharacterHeader detail={detail} />

        <div className="space-y-3">
          <CharacterKpis detail={detail} />

          <CharacterHero
            name={detail.name}
            ip={detail.ip}
            characterKey={detail.key}
            index={detail.index}
            gate={detail.indexGate}
            monthly={detail.monthly}
          />

          {/* §7 pair — two different questions (which sets ‖ which venues), so
              they share a row; items-stretch (the default) gives both frames one
              top and one bottom edge, each card `fill`s with its note anchored
              to the foot. Stacks below lg. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <CharacterBySet rows={detail.bySet} ip={detail.ip} />
            <CharacterWhereItTrades venues={detail.byVenue} />
          </div>

          <CharacterCardsTable rows={detail.top} characterName={detail.name} />
        </div>
      </div>
    </>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ key: string; character: string }> }) {
  const { key, character } = await params;
  const detail = await getCharacterDetail(key, decodeURIComponent(character)).catch(() => null);
  if (!detail) return { title: "Character not found · VARIBLE" };
  return {
    title: `${detail.name} · ${detail.ipName} · VARIBLE`,
    description: `${detail.name} across every ${detail.ipName} set and grade — ${detail.identities.toLocaleString("en-US")} cards, ${detail.slabs.toLocaleString("en-US")} slabs, 30-day resale by set and venue.`,
  };
}
