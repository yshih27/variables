import Link from "next/link";
import type { GachaBigHit } from "@/lib/data/gachaDuneCache";
import { proxyImg } from "@/lib/img";
import { formatCompactUsd } from "@/lib/format";
import { cardHref, cardSupported } from "@/lib/card/ids";

const TIER_COLOR: Record<string, string> = {
  SPrT: "#f3ff42",
  LGND: "#ffb84d",
  Epic: "#c77dff",
  High: "#5fa3ff",
  Mid: "#6cf48a",
  Low: "#707070",
};

const PLATFORM_LABEL: Record<string, string> = {
  "collector-crypt": "Collector Crypt",
  beezie: "Beezie",
  phygitals: "Phygitals",
};

/**
 * Big Hits — the highest-FMV cards pulled from gacha in the last 7d.
 * Card photo + insured value + rarity tier + time.
 */
export function GachaBigHitsRail({ hits }: { hits: GachaBigHit[] }) {
  const has = hits.length > 0;
  return (
    <section className="mt-10">
      <div className="mb-4 flex items-end gap-2">
        <h2 className="flex items-center gap-2 text-[22px] font-semibold tracking-[-0.005em]">
          <span aria-hidden>★</span> Big Hits
        </h2>
        <span className="pb-0.5 text-[12px] text-ink-3">biggest pulls · last 7d</span>
      </div>

      {has ? (
        <div className="scroll-x flex gap-4 pb-2">
          {hits.map((h, i) =>
            cardSupported(h.platform) ? (
              <Link key={`${h.mint}:${i}`} href={cardHref(h.platform, h.mint)} className="block">
                <HitCard hit={h} rank={i + 1} />
              </Link>
            ) : (
              <HitCard key={`${h.mint}:${i}`} hit={h} rank={i + 1} />
            ),
          )}
        </div>
      ) : (
        <div className="scroll-x flex gap-4 pb-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-[238px] min-w-[180px] rounded-xl border border-line/50 bg-bg-1"
            />
          ))}
        </div>
      )}
    </section>
  );
}

function HitCard({ hit, rank }: { hit: GachaBigHit; rank: number }) {
  const src = proxyImg(hit.image ?? hit.imageFallback ?? undefined);
  const tierColor = TIER_COLOR[hit.tier] ?? "#707070";
  return (
    <div className="group relative flex min-w-[180px] max-w-[180px] flex-col overflow-hidden rounded-xl border border-line/60 bg-bg-1">
      <div
        className="relative aspect-[3/4] overflow-hidden"
        style={{
          background:
            "radial-gradient(circle at 50% 30%, rgba(255,255,255,0.05), transparent 65%), #0c0c0c",
        }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            className="absolute inset-0 h-full w-full object-contain p-3 drop-shadow-[0_8px_18px_rgba(0,0,0,0.55)]"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0" />
        )}
        <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-ink-2 backdrop-blur">
          #{String(rank).padStart(2, "0")}
        </span>
        <span
          className="absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-black"
          style={{ background: tierColor }}
        >
          {hit.tier}
        </span>
        <span className="absolute bottom-2 right-2 rounded-md bg-yellow px-2 py-[3px] text-[12px] font-bold text-black tabular shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
          {formatCompactUsd(hit.valueUsd)}
        </span>
      </div>
      <div className="flex flex-col gap-1 px-3 py-2.5">
        <span className="line-clamp-2 h-[32px] text-[11.5px] font-semibold leading-[1.35]">
          {hit.name}
        </span>
        <span className="text-[10.5px] text-ink-3">
          {PLATFORM_LABEL[hit.platform] ?? hit.platform} · {timeAgo(hit.at)}
        </span>
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  const h = Math.round(s / 3600);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
