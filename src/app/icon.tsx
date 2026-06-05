import { ImageResponse } from "next/og";

/**
 * Auto-generated favicon. Matches the NavBar brand chip: yellow square,
 * black "T" mark. Next.js will pick this up at all the standard sizes.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f3ff42",
          borderRadius: 6,
          fontSize: 22,
          fontWeight: 900,
          color: "#000",
          fontFamily: "system-ui, -apple-system, Helvetica, Arial",
        }}
      >
        T
      </div>
    ),
    { ...size },
  );
}
