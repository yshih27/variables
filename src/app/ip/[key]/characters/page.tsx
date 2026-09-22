import { notFound } from "next/navigation";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { Breadcrumbs } from "@/components/shell/Breadcrumbs";
import { StatCard, StatCardRow } from "@/components/StatCard";
import { CharacterLeaderboard } from "@/components/characters/CharacterLeaderboard";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { readCharacterLeaderboard } from "@/lib/data/characterRollups";
import { hasCharacterExtractor } from "@/lib/card/character";
import { IP_CATALOG } from "@/lib/data/ipCatalog";
import { formatCompactUsd } from "@/lib/format";

/**
 * /ip/[key]/characters — the IP's character leaderboard, sibling of /sets and
 * /grades with the same skeleton: header line, a StatCard row, one table.
 *
 * One read: `readCharacterLeaderboard` (the character-rollups snapshot). The
 * IP's name comes from the catalog, not a second reader. An IP without a
 * character extractor has no such page — `notFound()`, and proxy.ts makes it
 * a real 404 before this renders.
 */
export const revalidate = 1800;

const ipNameOf = (ip: string) => IP_CATALOG.find((i) => i.key === ip)?.name ?? null;

export default async function IPCharactersPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const ipName = ipNameOf(key);
  if (!ipName || !hasCharacterExtractor(key)) notFound();
  const [rows, ticker] = await Promise.all([readCharacterLeaderboard(key, 5000), buildMarketTicker()]);

  const withIndex = rows.filter((r) => r.indexLatest).length;
  // Σ of the top ten's shares — per character, so a two-character card is in
  // two of the ten; the sub says so rather than letting the figure read as a
  // partition of the IP.
  const top10Share = rows.slice(0, 10).reduce((a, r) => a + r.shareOfIp30d, 0);
  const vol30 = rows.reduce((a, r) => a + r.volume30d, 0);

  return (
    <>
      <NavBar ticker={ticker} />
      <div className="px-8 pt-6 pb-20 font-sans">
        <Breadcrumbs />
        <h1 className="mb-1 text-[20px] font-bold leading-none tracking-[-0.01em]">{ipName} · Characters</h1>
        <p className="mb-3 max-w-2xl text-[13px] leading-relaxed text-ink-3">
          Which characters carry the resale market across every set and grade — the last 30 days, every
          venue&apos;s secondary sales.{" "}
          <Link href="/methodology#economics" className="text-ink-2 underline-offset-2 hover:text-yellow hover:underline">
            How this is measured →
          </Link>
        </p>

        <div className="space-y-3">
          <StatCardRow cols={3}>
            <StatCard
              label="Characters tracked"
              value={rows.length ? rows.length.toLocaleString("en-US") : "—"}
              sub={rows.length ? `${formatCompactUsd(vol30)} of 30d resale carries a character` : "no character has traded"}
              accent
            />
            <StatCard
              label="With a published index"
              value={rows.length ? String(withIndex) : "—"}
              sub="20 priced cards in two months running"
            />
            <StatCard
              label="Top 10 · share of resale"
              value={rows.length ? `${top10Share.toFixed(0)}%` : "—"}
              sub="same panel · a card with two characters counts under both"
            />
          </StatCardRow>

          {rows.length ? (
            <CharacterLeaderboard rows={rows} ip={key} />
          ) : (
            <p className="text-[12.5px] text-ink-3">No {ipName} sale in the last 30 days names a character.</p>
          )}
        </div>
      </div>
    </>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const ipName = ipNameOf(key);
  if (!ipName || !hasCharacterExtractor(key)) return { title: "Not found · VARIBLE" };
  return {
    title: `${ipName} Characters · VARIBLE`,
    description: `Which ${ipName} characters carry the resale market — 30-day sales and volume across every set, grade and venue.`,
  };
}
