import { SITE_ORIGIN } from "@/lib/site";

/**
 * The not-found for `/embed/*` — a bare, honest frame, not the site's 404 page.
 *
 * ⚠️ AN EMBED RENDERS INSIDE SOMEONE ELSE'S PAGE. The site's own not-found is a
 * full-width page with a nav and a heading; dropped into a venue's 420×120
 * iframe it is a wall of nothing. This says the one true thing in the chip's own
 * box — we have no price for this card — and keeps the way back.
 *
 * ⚠️ IT NEVER SHOWS A NUMBER. The whole reason an unknown slug must not render
 * a chip is that an embed with an invented figure is worse than a broken one.
 */
export default function EmbedNotFound() {
  return (
    <div
      style={{
        width: 420,
        maxWidth: "100%",
        height: 120,
        boxSizing: "border-box",
        background: "#0a0a0c",
        border: "1px solid #26262c",
        borderRadius: 12,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 6,
      }}
    >
      <span style={{ color: "#b8b8b8", fontSize: 13, fontWeight: 600 }}>No price for this card</span>
      <span style={{ color: "#707070", fontSize: 11 }}>Varible has never priced this identity.</span>
      <a href={SITE_ORIGIN} target="_top" rel="noopener" style={{ color: "#bfef01", fontSize: 11, fontWeight: 700, textDecoration: "none" }}>
        Varible ↗
      </a>
    </div>
  );
}
