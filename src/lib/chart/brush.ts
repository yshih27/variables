/**
 * THE BRUSH — the one fill every stacked band, bar and treemap tile on the
 * terminal shares: the series colour lit along the top of its shape, falling
 * to the page ground at the bottom. The Index Studio's area fill drew it
 * first; the Total Volume bars, the holders line and the economics bands
 * followed. The categories page's market-cap pair (2026-09-17, designer's
 * recommendation) put it on the treemap tiles and the composition bands so
 * the pair reads as part of the page instead of a block of flat brand colour.
 *
 * `color-mix` keeps it one function of one colour: no per-series dark stops to
 * maintain, and a token (`var(--color-yellow)`) passes through untouched.
 */
export function brushGradient(color: string): string {
  return `linear-gradient(180deg, ${color} 0%, ${color} 30%, color-mix(in srgb, ${color} 58%, var(--color-bg)) 68%, color-mix(in srgb, ${color} 16%, var(--color-bg)) 100%)`;
}

/**
 * Composition palette — "accent the leaders, brand the rest". The largest
 * share takes the terminal's own colour (the market IS that series at 80%),
 * the second the secondary green next to it, and everything smaller keeps its
 * catalog colour so the long tail stays tellable apart. Rank-ordered on
 * purpose: the top band is the one the page is about, whichever IP holds it.
 */
export function leaderColor(rank: number, brand: string): string {
  if (rank === 0) return "var(--color-yellow)";
  if (rank === 1) return "var(--color-green)";
  return brand;
}
