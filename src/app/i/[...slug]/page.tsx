import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { getIdentityDetail } from "@/lib/data/identityDetail";
import { IdentityHeader } from "@/components/identity/IdentityHeader";
import { IdentityKpis } from "@/components/identity/IdentityKpis";
import { IdentitySalesChart } from "@/components/identity/IdentitySalesChart";
import { GradeLadder } from "@/components/identity/GradeLadder";
import { WhereItTrades } from "@/components/identity/WhereItTrades";
import { SlabsTable } from "@/components/identity/SlabsTable";
import { identityTitle } from "@/lib/card/identityView";
import { identityDisplayName } from "@/lib/card/identity";

/**
 * /i/<ip>/<set>/<number>/<name>/<grade>[/<edition>][/<lang>] — one card
 * IDENTITY across every venue and every slab. The page a buyer wants: "this
 * exact card, this grade, everywhere it trades".
 *
 * The venue page's skeleton: header → KPI strip → ONE hero → one side pair of
 * different questions (§7) → the table. Every zone answers one question and
 * every number on the page comes from ONE read, `getIdentityDetail` (cached 30
 * min in the reader); nothing here reads a second source.
 *
 * `notFound()` for a slug the reader cannot resolve. A malformed slug (fewer
 * than five segments) never reaches here — `proxy.ts` rewrites it to a real 404.
 */
export const dynamic = "force-dynamic";

const slugOf = (parts: string[]) => parts.map((p) => decodeURIComponent(p)).join("/");

export default async function IdentityPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const detail = await getIdentityDetail(slugOf(slug));
  if (!detail) notFound();

  return (
    <>
      <NavBar ticker={await buildMarketTicker()} />
      <div className="px-8 pt-6 pb-20 font-sans">
        <IdentityHeader detail={detail} />

        <div className="space-y-3">
          <IdentityKpis detail={detail} />

          <IdentitySalesChart
            sales={detail.sales}
            monthly={detail.monthly}
            title={identityTitle(detail.parts)}
            slug={detail.slug}
          />

          {/* §7 pair — two different questions (what each grade is worth ‖ where
              to buy it), so they share a row; items-stretch (the default) so
              both frames share a top and a bottom edge, and each card `fill`s
              with its foot note anchored to the bottom. Stacks below lg. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <GradeLadder ladder={detail.gradeLadder} thisGrade={detail.parts.grade} />
            <WhereItTrades detail={detail} />
          </div>

          <SlabsTable
            tokens={detail.tokens}
            number={detail.parts.number}
            name={identityDisplayName(detail.parts.name)}
            grade={detail.parts.grade}
          />
        </div>
      </div>
    </>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const detail = await getIdentityDetail(slugOf(slug)).catch(() => null);
  if (!detail) return { title: "Card not found · VARIBLE" };
  const p = detail.parts;
  const venues = new Set(detail.tokens.map((t) => t.platform)).size;
  const where = [p.setName, p.number ? `#${p.number}` : null].filter(Boolean).join(" ");
  const title = `${identityTitle(p)} · VARIBLE`;
  const description = `${identityTitle(p)}${where ? ` (${where})` : ""} — ${detail.tokens.length} slab${detail.tokens.length === 1 ? "" : "s"} across ${venues} venue${venues === 1 ? "" : "s"}, every realized sale and the monthly identity price.`;
  // The share image is a route handler (a catch-all cannot carry an
  // opengraph-image.tsx); resolved against metadataBase like the others.
  const image = { url: `/api/og/identity/${detail.slug}`, width: 1200, height: 630, alt: identityTitle(p) };
  return {
    title,
    description,
    openGraph: { title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}
