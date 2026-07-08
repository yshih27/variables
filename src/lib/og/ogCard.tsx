import { ImageResponse } from "next/og";

/**
 * ONE shared OpenGraph template (F9-1) behind every per-entity share image:
 * `/ip/[key]`, `/platform/[key]`, `/card/[id]` (and `/report`). Each route
 * fetches its own data via the existing readers, then hands a name + headline
 * stat (+ optional sparkline + brand accent) to `renderOgCard`, so every shared
 * link becomes a branded stat card that reads as one system.
 *
 * Satori (next/og's engine) constraints honored here: flexbox-only layout,
 * inline styles only, system fonts (no font-file loading), and the sparkline
 * drawn as a plain <svg> polyline. Keep new visuals inside these rails.
 *
 * These routes pin the Node runtime at the route level (the readers hit the DB).
 */
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const YELLOW = "#f3ff42";
const PURPLE = "#a18cff";
const INK_DIM = "#707070";
const BG = "radial-gradient(circle at 30% 30%, #1a1a1a 0%, #000 60%)";
const FONT = "system-ui, -apple-system, Helvetica, Arial";

export type OgStat = { label: string; value: string };

export type OgCardOpts = {
  /** Small uppercase kicker, e.g. "IP · Rank #3" or "Platform · Solana". */
  eyebrow: string;
  /** Entity name — the headline. */
  title: string;
  /** Headline stat (big, accent-colored), e.g. { value: "$1.2M", label: "Market cap" }. */
  stat?: OgStat;
  /** Optional secondary stat shown inline after the headline stat. */
  substat?: OgStat;
  /** Sparkline values (e.g. spark24h). Skipped when fewer than 2 finite points. */
  spark?: number[];
  /** Entity tint for the sparkline (e.g. an IP's brand color). The headline stat
   *  itself always stays brand-yellow for legibility on black + cohesion across
   *  entities. Defaults to the brand yellow. */
  accent?: string;
};

/** Build an SVG polyline `points` string from a series, or null if too sparse. */
function sparkPoints(spark: number[] | undefined, w: number, h: number): string | null {
  const v = (spark ?? []).filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const range = max - min;
  // A flat series (all equal — e.g. degraded/empty data) conveys no trend and
  // would render as a stray horizontal rule, so skip the sparkline entirely and
  // let the clean stat card stand on its own.
  if (range <= 0) return null;
  const step = w / (v.length - 1);
  const pad = 4; // keep the stroke off the top/bottom edges
  return v
    .map((y, i) => {
      const px = i * step;
      const py = h - pad - ((y - min) / range) * (h - pad * 2);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");
}

/** Render the shared branded stat card as an ImageResponse (1200×630 PNG). */
export function renderOgCard(opts: OgCardOpts): ImageResponse {
  const accent = opts.accent || YELLOW;
  const pts = sparkPoints(opts.spark, 560, 64);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          fontFamily: FONT,
          color: "#fff",
        }}
      >
        {/* Brand row */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 14,
              background: YELLOW,
              color: "#000",
              fontSize: 42,
              fontWeight: 900,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            V
          </div>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700, letterSpacing: 1 }}>
            VARIABLE
          </div>
        </div>

        {/* Middle: eyebrow → title → stat → spark */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              display: "flex",
              fontSize: 24,
              color: PURPLE,
              textTransform: "uppercase",
              letterSpacing: 2,
              fontWeight: 500,
            }}
          >
            {opts.eyebrow}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 76,
              lineHeight: 1.02,
              fontWeight: 800,
              letterSpacing: -2,
              maxWidth: 1040,
            }}
          >
            {opts.title}
          </div>
          {opts.stat && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
              <div style={{ display: "flex", fontSize: 54, fontWeight: 800, color: YELLOW }}>
                {opts.stat.value}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 26,
                  color: INK_DIM,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                {opts.stat.label}
              </div>
              {opts.substat && (
                <div style={{ display: "flex", fontSize: 26, color: INK_DIM }}>
                  {`· ${opts.substat.value} ${opts.substat.label}`}
                </div>
              )}
            </div>
          )}
          {pts && (
            <svg width={560} height={64} viewBox="0 0 560 64" style={{ marginTop: 10 }}>
              <polyline
                points={pts}
                fill="none"
                stroke={accent}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            color: INK_DIM,
            fontSize: 22,
          }}
        >
          <div style={{ display: "flex" }}>Beezie · Courtyard · Collector Crypt · Phygitals</div>
          <div style={{ display: "flex" }}>VARIABLE</div>
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}
