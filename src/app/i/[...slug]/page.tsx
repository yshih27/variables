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
import { identityDisplayName, identitySlug } from "@/lib/card/identity";
import { parseIdentityKey } from "@/lib/data/traits";

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
 *
 * ⚠️ ISR, NOT PER-REQUEST. Nothing here reads a request-time API (no cookies,
 * headers or searchParams — only `params`), and every figure comes from
 * `getIdentityDetail`, which is already `unstable_cache`d for 30 minutes. A
 * per-request render therefore bought no freshness: it re-ran React over the
 * same cached detail on every hit and re-sent the whole RSC payload from the
 * function each time. With `revalidate` the page is written once per slug per
 * 30 minutes and every hit inside that window is served by the CDN — no
 * function invocation, no CPU, no origin transfer (the September 2026 Hobby
 * pause was Active CPU, origin transfer and ISR writes, all three over quota
 * under ~25K crawler hits a day on these pages). The horizon equals the
 * reader's, so a page can never be older than the detail it was built from.
 * The cost of the trade is one ISR write per slug per window; the reader's
 * own data-cache write was already being paid.
 */
export const revalidate = 1800;

/**
 * ⚠️ WITHOUT THIS EXPORT, `revalidate` ABOVE IS A NO-OP. Next's rule for a
 * dynamic segment ("you must return an empty array from generateStaticParams,
 * or use `dynamic = 'force-static'`, in order to revalidate paths at runtime"):
 * a route with a dynamic segment and no `generateStaticParams` is rendered on
 * every request, whatever `revalidate` says. Measured on `next start` before
 * this export: every dynamic-segment page, including `/ip/[key]` and
 * `/platform/[key]` which have declared `revalidate = 1800` since July,
 * answered `cache-control: private, no-cache, no-store`; after it,
 * `s-maxage=1800, stale-while-revalidate` and `x-nextjs-cache: HIT` on the
 * second request. An empty array prerenders nothing at build (55K identities
 * would be absurd) and caches every path on its first request; `dynamicParams`
 * stays at its default (true), so an unlisted slug renders on demand. A
 * well-formed slug that resolves nothing renders the not-found UI and is cached
 * like any other path — still as a 200 (the soft 404 proxy.ts documents: the
 * `notFound()` fires inside the `loading.tsx` boundary), so a crawler that
 * guesses slugs now gets a cheap answer, not a correct status.
 */
export async function generateStaticParams() {
  return [];
}

const slugOf = (parts: string[]) => parts.map((p) => decodeURIComponent(p)).join("/");

export default async function IdentityPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const detail = await getIdentityDetail(slugOf(slug));
  if (!detail) notFound();

  // The card's ONE url, from the key the page was built on — the same
  // derivation the price payload and the proxy's 301 use, so the embed
  // snippets cannot pin a superseded form.
  const pk = parseIdentityKey(detail.key);
  const canonicalSlug = (pk ? identitySlug(pk.ip, pk.parts) : null) ?? detail.slug;

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
            canonicalSlug={canonicalSlug}
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
