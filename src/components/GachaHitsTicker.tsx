import Link from "next/link";
import { proxyImg } from "@/lib/img";
import { cardHref, cardSupported } from "@/lib/card/ids";
import { CardArt } from "./CardImage";
import { Section } from "./Section";
import type { CoverflowHit } from "@/lib/data/gachaHits";

/**
 * LIVE hits ticker — the slim ambient band of biggest realized pulls under the
 * hero. Proof-of-life, not a decision tool, so it drifts continuously instead
 * of occupying a full-height carousel.
 *
 * Server component, zero JS: a pure-CSS marquee (.ght-* in globals.css). Two
 * identical rows translate -50% for a seamless loop; hover pauses; edges fade.
 *
 * SEAMLESS WITH FEW HITS: the -50% loop only reads as continuous when ONE row
 * is at least as wide as the visible band — otherwise a gap appears after the
 * last chip. We can't measure width in a server component, so we TILE the hit
 * list enough times that a row comfortably overflows a wide viewport. Speed is
 * kept ∝ chip count so the drift velocity stays constant regardless of tiling.
 */

const PF: Record<string, { short: string; color: string; name: string }> = {
  "collector-crypt": { short: "CC", color: "#2bd6a0", name: "Collector Crypt" },
  phygitals: { short: "PH", color: "#ffd23d", name: "Phygitals" },
  beezie: { short: "B", color: "#5b9bff", name: "Beezie" },
};

const CHIP_PX = 320; // rough chip width, for the tiling estimate
const TARGET_ROW_PX = 2100; // ≥ the 1760 container + margin

export function GachaHitsTicker({
  hits,
  windowLabel,
}: {
  hits: CoverflowHit[];
  windowLabel: string;
}) {
  if (hits.length === 0) return null;

  const reps = Math.max(1, Math.ceil(TARGET_ROW_PX / (hits.length * CHIP_PX)));
  const tiled = Array.from({ length: reps }, () => hits).flat();
  const dur = `${Math.max(40, tiled.length * 6)}s`;

  const row = (dup: boolean) => (
    <div className="ght-row" aria-hidden={dup || undefined}>
      {tiled.map((h, i) => (
        <Chip key={`${dup ? "b" : "a"}-${i}-${h.mint}`} hit={h} dup={dup} />
      ))}
    </div>
  );

  return (
    <Section
      title="Live hits"
      subtitle={`Biggest realized pulls · ${windowLabel}`}
      className="mt-7 font-sans"
      flush
    >
      <div className="ght" aria-label={`Biggest gacha hits, ${windowLabel}`}>
        <div className="ght-mask">
          <div className="ght-track" style={{ ["--ght-dur" as string]: dur }}>
            {row(false)}
            {row(true)}
          </div>
        </div>
      </div>
    </Section>
  );
}

function Chip({ hit, dup }: { hit: CoverflowHit; dup: boolean }) {
  const link = cardSupported(hit.platformKey) ? cardHref(hit.platformKey, hit.mint) : null;
  const pf = PF[hit.platformKey] ?? { short: "?", color: "#888", name: hit.platform };
  const body = (
    <>
      <span className={`ght-art${hit.platformKey === "phygitals" ? " ght-art--zoom" : ""}`}>
        {/* Shared card-art fallback (D3): dead/missing prize art degrades to the
            platform-colored slab glyph instead of a blank box. */}
        <CardArt
          sources={[proxyImg(hit.image ?? undefined), proxyImg(hit.imageFallback ?? undefined)]}
          color={pf.color}
          imgClassName=""
        />
      </span>
      <span className="ght-meta">
        <span className="ght-val">
          {hit.hit}
          {hit.grade && <em className="ght-grade">{hit.grade}</em>}
        </span>
        <span className="ght-name">{hit.name.replace(/^\d{4}\s+/, "")}</span>
        <span className="ght-sub">
          <span className="ght-pf" style={{ background: pf.color }} title={pf.name}>
            {pf.short}
          </span>
          <span className="ght-sub-t">
            {pf.name}
            {hit.pack ? ` · ${hit.pack}` : ""} · {hit.ago}
          </span>
        </span>
      </span>
    </>
  );
  // The duplicated row is purely visual — keep its chips out of the tab order.
  return link ? (
    <Link href={link} className="ght-chip" tabIndex={dup ? -1 : undefined}>
      {body}
    </Link>
  ) : (
    <span className="ght-chip">{body}</span>
  );
}
