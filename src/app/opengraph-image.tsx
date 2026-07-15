import { ImageResponse } from "next/og";
import {
  BRAND_LIME,
  BRAND_LOCKUP_MARK_PATH,
  BRAND_LOCKUP_VIEWBOX,
  BRAND_LOCKUP_WORDMARK_PATH,
} from "@/lib/brand";

/**
 * Default OG image for social shares. Returns a 1200×630 card.
 * Per-route OG variants can be added later (e.g. /ip/[key]/opengraph-image.tsx).
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "VARIBLE — real cards, real prices, indexed";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "radial-gradient(circle at 30% 30%, #1a1a1a 0%, #000 60%)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          fontFamily: "system-ui, -apple-system, Helvetica, Arial",
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <svg width={210} height={48} viewBox={BRAND_LOCKUP_VIEWBOX} fill="none">
            <path d={BRAND_LOCKUP_MARK_PATH} fill={BRAND_LIME} />
            <path d={BRAND_LOCKUP_WORDMARK_PATH} fill="#fff" />
          </svg>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 24,
              color: "#a18cff",
              textTransform: "uppercase",
              letterSpacing: 2,
              fontWeight: 500,
            }}
          >
            Tokenized Collectibles
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              // Longhand, not `gap: "0 20px"` — satori ignores the shorthand here
              // and the phrases render touching ("Real cards.Real prices.").
              columnGap: 20,
              rowGap: 0,
              fontSize: 80,
              lineHeight: 1.05,
              fontWeight: 800,
              letterSpacing: -2,
              maxWidth: 1040,
            }}
          >
            <span>Real cards.</span>
            <span style={{ color: "#bfef01" }}>Real prices.</span>
            <span>Indexed.</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            color: "#707070",
            fontSize: 22,
          }}
        >
          <span>Beezie · Courtyard · Collector Crypt · Phygitals</span>
          <span>VARIBLE</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
