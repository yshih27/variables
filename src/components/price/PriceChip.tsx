import { GradeChip } from "../GradeChip";
import type { ReferencePrice } from "@/lib/data/referencePrice";
import { formatCompactUsd } from "@/lib/format";
import { SITE_ORIGIN } from "@/lib/site";
import { identityHref } from "@/lib/card/identity";

/**
 * THE PRICE CHIP — what a venue pastes onto its own listing page.
 *
 * `/embed/price/<slug>` renders exactly this and nothing else: no shell, no
 * nav, no actions. It is the surface with the least context around it, so
 * every rule the identity page follows is enforced HERE too, tighter:
 *
 * ⚠️ NO LOADING STATE, NO LAYOUT SHIFT, NO CLIENT FETCH. The numbers are
 * server-rendered from `getReferencePrice` and the frame is a fixed box, so the
 * iframe a venue sizes once is the size it stays. A chip that reflowed would
 * push the host page's content around on every load.
 *
 * ⚠️ EVERY FALLBACK IS A DOWNGRADE, NEVER A SUBSTITUTE. With no monthly price
 * it says "no price this month" and shows the last SALE; with no sale at all it
 * says "no sale yet" and counts slabs. A floor is never the headline (an ask is
 * not a price) — the identity page's own rule, applied where nobody can see the
 * page. An unknown slug never reaches this component: the route 404s.
 *
 * ⚠️ THE MARK IS NOT DECORATION. `Varible ↗` is the attribution and the way
 * back to the card's page; it is part of the chip, not an option, and it opens
 * the top window (a venue's iframe must not become a trap).
 */

export type ChipSize = "sm" | "md";
export const CHIP_SIZES: readonly ChipSize[] = ["sm", "md"];
export type ChipTheme = "dark" | "light";
export const CHIP_THEMES: readonly ChipTheme[] = ["dark", "light"];

/** The brief's boxes: ≤ 320×96 at sm, ≤ 420×120 at md. */
export const CHIP_BOX: Record<ChipSize, { w: number; h: number }> = {
  sm: { w: 320, h: 96 },
  md: { w: 420, h: 120 },
};

/** The two grounds. Dark is the site's; light is its inverse in the same family. */
const THEME: Record<ChipTheme, { bg: string; line: string; ink: string; ink2: string; ink3: string; chipBg: string }> = {
  dark: { bg: "#0a0a0c", line: "#26262c", ink: "#ffffff", ink2: "#b8b8b8", ink3: "#707070", chipBg: "#1a1a1e" },
  light: { bg: "#ffffff", line: "#e4e4e7", ink: "#0a0a0c", ink2: "#3f3f46", ink3: "#71717a", chipBg: "#f4f4f5" },
};

const LIME = "#bfef01";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08" → "Aug". */
function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return MON[m - 1] ?? month;
}

/** "2026-09-09T…" → "Sep 9". */
function dayLabel(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const VENUE: Record<string, string> = {
  "collector-crypt": "Collector Crypt",
  beezie: "Beezie",
  courtyard: "Courtyard",
  phygitals: "Phygitals",
  dyli: "DYLI",
};

/**
 * The headline and the line under it, from the payload alone — the ONE place
 * the chip decides what it can claim, so the two sizes and both themes cannot
 * say different things about the same card.
 */
export function chipLines(p: ReferencePrice): { headline: string; qualifier: string | null; under: string; figure: boolean } {
  if (p.price) {
    return {
      headline: formatCompactUsd(p.price.priceUsd),
      figure: true,
      qualifier: `${monthLabel(p.price.month)} · ${p.price.n} sale${p.price.n === 1 ? "" : "s"}${p.price.thin ? " · thin" : ""}`,
      under: p.lastSale
        ? `last ${formatCompactUsd(p.lastSale.priceUsd)} · ${VENUE[p.lastSale.venue] ?? p.lastSale.venue} · ${dayLabel(p.lastSale.ts)}`
        : `${p.slabs} slab${p.slabs === 1 ? "" : "s"} tracked`,
    };
  }
  if (p.lastSale) {
    // No month cleared the two-sale floor: the last SALE, named as a sale.
    return {
      headline: formatCompactUsd(p.lastSale.priceUsd),
      figure: true,
      qualifier: "last sale",
      under: `no price this month · ${VENUE[p.lastSale.venue] ?? p.lastSale.venue} · ${dayLabel(p.lastSale.ts)}`,
    };
  }
  // ⚠️ NOT A FIGURE, so it is not set in the figure's face or size: "no sale
  // yet" at 26px mono reads like a number someone has redacted.
  return { headline: "no sale yet", figure: false, qualifier: null, under: `${p.slabs} slab${p.slabs === 1 ? "" : "s"} tracked` };
}

export function PriceChip({ price, size, theme }: { price: ReferencePrice; size: ChipSize; theme: ChipTheme }) {
  const t = THEME[theme];
  const box = CHIP_BOX[size];
  const md = size === "md";
  const { headline, qualifier, under, figure } = chipLines(price);
  const href = `${SITE_ORIGIN}${identityHref(price.canonicalSlug)}`;

  return (
    <div
      data-price-chip
      data-size={size}
      data-theme={theme}
      style={{
        width: box.w,
        height: box.h,
        background: t.bg,
        border: `1px solid ${t.line}`,
        borderRadius: 12,
        boxSizing: "border-box",
        padding: md ? "12px 14px" : "10px 12px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        overflow: "hidden",
      }}
    >
      {/* Which card — the name, then the grade through the grade SSOT's chip. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: t.ink,
            fontSize: md ? 13 : 12,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
          title={price.name}
        >
          {price.name}
        </span>
        <span style={{ flex: "0 0 auto" }}>
          <GradeChip label={price.grade} />
        </span>
      </div>

      {/* The figure. "Varible price" is the claim's name, in the brand's word. */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
        <span style={{ color: t.ink3, fontSize: md ? 11 : 10, whiteSpace: "nowrap" }}>Varible price</span>
        <span
          className={figure ? "tabular" : undefined}
          style={{
            color: figure ? t.ink : t.ink2,
            fontSize: figure ? (md ? 26 : 21) : md ? 16 : 14,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: figure ? "-0.02em" : "-0.01em",
            whiteSpace: "nowrap",
          }}
        >
          {headline}
        </span>
        {qualifier ? (
          <span
            style={{
              color: t.ink3,
              fontSize: md ? 11 : 10,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {qualifier}
          </span>
        ) : null}
      </div>

      {/* The receipt line, and the attribution that is part of the chip. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
        <span
          style={{
            color: t.ink2,
            fontSize: md ? 11 : 10,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {under}
        </span>
        <a
          href={href}
          target="_top"
          rel="noopener"
          style={{
            flex: "0 0 auto",
            color: LIME,
            fontSize: md ? 11 : 10,
            fontWeight: 700,
            textDecoration: "none",
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
          }}
        >
          Varible ↗
        </a>
      </div>
    </div>
  );
}
