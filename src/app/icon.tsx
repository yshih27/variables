import { ImageResponse } from "next/og";
import { BRAND_LIME, BRAND_MARK_PATH, BRAND_MARK_VIEWBOX } from "@/lib/brand";

/**
 * Auto-generated favicon: the VARIBLE "V" mark in lime on the brand's near-black
 * ground — the boards' compact treatment, drawn from the same geometry the nav
 * uses (both read the path from @/lib/brand). Next.js picks this up at every
 * standard size.
 *
 * The mark sits on an opaque square rather than floating transparent: a tab strip
 * is near-white in a light OS theme, where bare lime-on-white is close to
 * illegible. The ground is square (no radius) per the brand's sharp-edge system.
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
          background: "#0a0a0a",
        }}
      >
        <svg width="21" height="20" viewBox={BRAND_MARK_VIEWBOX} fill="none">
          <path d={BRAND_MARK_PATH} fill={BRAND_LIME} />
        </svg>
      </div>
    ),
    { ...size },
  );
}
