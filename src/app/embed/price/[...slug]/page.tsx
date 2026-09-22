import { notFound } from "next/navigation";
import { getReferencePrice } from "@/lib/data/referencePrice";
import { PriceChip, CHIP_BOX, CHIP_SIZES, CHIP_THEMES, type ChipSize, type ChipTheme } from "@/components/price/PriceChip";

/**
 * `/embed/price/<slug>` — the price chip, alone on a page, for an iframe on
 * someone else's site.
 *
 * ⚠️ SAME READER AS THE IDENTITY PAGE AND THE BADGE. `getReferencePrice` wraps
 * `getIdentityDetail`, which is what /i/<slug> renders from — so a venue's chip,
 * the badge in its card view, the API and our own page cannot print different
 * numbers for the same card.
 *
 * ⚠️ SERVER-RENDERED AND FIXED-SIZE. No client fetch, no loading state, no
 * layout shift: the box is `CHIP_BOX`, the numbers are in the HTML, and the
 * iframe a venue sizes once stays that size. Cached 30 minutes, like the price
 * endpoint it shares a reader with.
 *
 * ⚠️ AN UNKNOWN SLUG IS A 404, NOT A BLANK CHIP. A chip that rendered empty for
 * a card we have never priced would be a claim we cannot make; `proxy.ts`
 * rejects a malformed path before this renders, and an unresolvable one lands
 * on the app's own not-found.
 *
 * Framing is permitted for `/embed/*` only (next.config.ts: `frame-ancestors *`).
 */
export const revalidate = 1800;

type Search = { size?: string; theme?: string };

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const price = await getReferencePrice((slug ?? []).map(decodeURIComponent).join("/")).catch(() => null);
  return {
    title: price ? `${price.name} · ${price.grade} — Varible price` : "Varible price",
    robots: { index: false, follow: false },
  };
}

export default async function PriceChipEmbed({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<Search>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const price = await getReferencePrice((slug ?? []).map(decodeURIComponent).join("/"));
  if (!price) notFound();

  // Unknown values fall back rather than 404 — a venue that typos `?size=large`
  // should still get a correct chip, and the size is not a claim about data.
  const size: ChipSize = (CHIP_SIZES as readonly string[]).includes(sp.size ?? "") ? (sp.size as ChipSize) : "md";
  const theme: ChipTheme = (CHIP_THEMES as readonly string[]).includes(sp.theme ?? "") ? (sp.theme as ChipTheme) : "dark";
  const box = CHIP_BOX[size];

  return (
    <div
      className="font-sans"
      // The page IS the chip: it occupies exactly the chip's box, so an iframe
      // sized to `CHIP_BOX` shows it with no scrollbar and no margin.
      style={{ width: box.w, height: box.h, margin: 0, background: "transparent", overflow: "hidden" }}
    >
      <PriceChip price={price} size={size} theme={theme} />
    </div>
  );
}
