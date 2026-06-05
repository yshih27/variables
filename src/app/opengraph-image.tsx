import { ImageResponse } from "next/og";

/**
 * Default OG image for social shares. Returns a 1200×630 card.
 * Per-route OG variants can be added later (e.g. /ip/[key]/opengraph-image.tsx).
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "TCG.market — the market for tokenized phygital collectibles";

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
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 14,
              background: "#f3ff42",
              color: "#000",
              fontSize: 44,
              fontWeight: 900,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            T
          </div>
          <div style={{ display: "flex", fontSize: 36, fontWeight: 700, letterSpacing: -0.5 }}>
            TCG
            <span style={{ color: "#707070", fontWeight: 500 }}>.market</span>
          </div>
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
              gap: "0 20px",
              fontSize: 80,
              lineHeight: 1.05,
              fontWeight: 800,
              letterSpacing: -2,
              maxWidth: 1040,
            }}
          >
            <span>The market for</span>
            <span style={{ color: "#f3ff42" }}>phygital</span>
            <span>collectibles.</span>
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
          <span>tcg.market</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
