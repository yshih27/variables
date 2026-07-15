/**
 * VARIBLE brand primitives — the ONE source of truth for the logo geometry.
 *
 * The paths are lifted verbatim from the supplied artwork in `public/brand/`
 * (`varible-lockup-on-dark.svg`, `varible-mark-lime.svg`). The public/ files stay
 * the canonical exports for anything outside the app (decks, press, favicons a
 * build step might rasterize); these constants are how the app itself draws the
 * logo, so the nav/footer render inline (no network round-trip, no logo flash)
 * and the OG templates can draw the same geometry under satori.
 *
 * Both consumers import from here so the two can never drift. If the artwork is
 * ever revised, update `public/brand/*.svg` AND these paths together.
 *
 * ⚠️ Colors are LITERAL hex, not `var(--color-yellow)`: satori (next/og) and the
 * Index Studio's PNG export both rasterize serialized SVG where CSS custom
 * properties never resolve — a var() here renders as black. The DOM components
 * may still override via a prop.
 */

/** Brand lime. Mirrors `--color-yellow` in globals.css — keep the two in step. */
export const BRAND_LIME = "#bfef01";

/**
 * The "V" mark. Tight viewBox (the source art floats the mark in a 150×150 pad
 * box, which would render it ~half scale in a nav-sized slot).
 */
export const BRAND_MARK_VIEWBOX = "37.52 39.45 74.96 71.1";
export const BRAND_MARK_PATH =
  "M85.4004 110.545H66.2227L37.5234 39.4551H56.7021L85.4004 110.545ZM112.477 39.4551L93.2988 88.6357L84.4688 88.6875L79.0781 75.7607L93.2988 39.4551H112.477Z";

/**
 * The horizontal lockup: mark + "VARIBLE" wordmark. Tight viewBox for the same
 * reason as above. The source art's clipPath is exactly the mark's own bounding
 * box (a no-op), so it's dropped here.
 */
export const BRAND_LOCKUP_VIEWBOX = "21.02 22.45 311.09 71.09";
/** Ratio for sizing by height: width = height * BRAND_LOCKUP_ASPECT. */
export const BRAND_LOCKUP_ASPECT = 311.09 / 71.09;
export const BRAND_LOCKUP_MARK_PATH =
  "M68.9004 93.5449H49.7227L21.0234 22.4551H40.2021L68.9004 93.5449ZM95.9766 22.4551L76.7988 71.6357L67.9688 71.6875L62.5781 58.7607L76.7988 22.4551H95.9766Z";
export const BRAND_LOCKUP_WORDMARK_PATH =
  "M134.058 66.8116H136.308L144.355 42.9347H152.992L141.881 74.5314H128.433L117.32 42.9347H126.009L134.058 66.8116ZM181.653 74.5314H172.958L170.174 67.004H157.18L154.395 74.5314H145.699L156.251 42.9347H171.102L181.653 74.5314ZM218.016 48.6193V58.0421L213.912 62.3439L219.383 74.5314H210.199L205.46 63.7267H192.271V74.5314H183.136V42.9347H212.544L218.016 48.6193ZM230.14 48.1066H230.091L229.993 71.4083V74.5314H221.444V71.4083L221.347 48.1066V42.9347H230.14V48.1066ZM267.409 48.6193V55.6349L264.967 58.2472L268.826 62.0363V68.8478L263.403 74.5314H233.066V42.9347H261.986L267.409 48.6193ZM280.651 66.7482H297.163V74.5314H271.517V42.9347H280.651V66.7482ZM332.109 50.7189H309.002V55.1232H330.302V62.3439H309.002V66.7482H332.109V74.5314H299.867V42.9347H332.109V50.7189ZM242.202 67.2599H257.981L259.69 65.4679V63.9825L257.981 62.1896H242.202V67.2599ZM159.476 59.629H167.878L164.556 50.1554H162.797L159.476 59.629ZM192.271 56.4542H207.414L209.124 54.6622V51.9991L207.414 50.2072H192.271V56.4542ZM242.202 55.5323H256.955L258.665 53.7404V51.9991L256.955 50.2072H242.202V55.5323Z";
