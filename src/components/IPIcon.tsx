"use client";

import { useState } from "react";
import type { CSSProperties } from "react";

type BlendMode = "normal" | "screen" | "lighten";

type Props = {
  name: string;
  short: string;
  color: string;
  logo?: string;
  /** CSS mix-blend-mode for the logo image (e.g. "screen" to drop dark
   *  lines into a dark theme). */
  iconBlendMode?: BlendMode;
  emoji?: string;
  size?: number;
};

export function IPIcon({
  name,
  short,
  color,
  logo,
  iconBlendMode = "normal",
  emoji,
  size = 32,
}: Props) {
  const dim = `${size}px`;
  const [logoFailed, setLogoFailed] = useState(false);

  if (logo && !logoFailed) {
    // Auto-screen for assets where dark outline pixels clash with the dark
    // theme (pokéball). Screen blend drops black into the bg while
    // preserving red and white.
    const autoScreen = /\/pokemon\.png$/i.test(logo);
    // Pixel-art logos need pixelated rendering to keep crisp edges.
    const pixelArt = /\/(pokemon|one-piece)\.png$/i.test(logo);
    // Per-asset scale: the pixel pokéball PNG has more transparent padding
    // than the one-piece PNG, so it renders visually smaller in the same
    // slot. Scale it up so the two icons look balanced.
    const autoScale = /\/pokemon\.png$/i.test(logo) ? 1.35 : 1;

    const effectiveBlend = iconBlendMode ?? (autoScreen ? "screen" : "normal");
    const imgStyle: CSSProperties = {
      width: "100%",
      height: "100%",
      objectFit: "contain",
    };
    if (effectiveBlend !== "normal") {
      imgStyle.mixBlendMode = effectiveBlend as CSSProperties["mixBlendMode"];
    }
    if (pixelArt) {
      imgStyle.imageRendering = "pixelated";
    }
    if (autoScale !== 1) {
      imgStyle.transform = `scale(${autoScale})`;
      imgStyle.transformOrigin = "center";
    }
    return (
      <span
        className="inline-flex flex-shrink-0 items-center justify-center"
        style={{ width: dim, height: dim }}
        aria-label={name}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logo}
          alt={name}
          width={size}
          height={size}
          style={imgStyle}
          onError={() => setLogoFailed(true)}
        />
      </span>
    );
  }

  if (emoji) {
    return (
      <span
        className="inline-flex flex-shrink-0 items-center justify-center"
        style={{ width: dim, height: dim, fontSize: size * 0.78, lineHeight: 1 }}
        aria-label={name}
      >
        {emoji}
      </span>
    );
  }

  return (
    <span
      className="inline-flex flex-shrink-0 items-center justify-center rounded-full font-bold"
      style={{
        width: dim,
        height: dim,
        background: color,
        color: "#000",
        fontSize: size * 0.34,
        letterSpacing: "0.02em",
      }}
      aria-label={name}
    >
      {short}
    </span>
  );
}
