import Link from "next/link";
import { Breadcrumbs } from "../shell/Breadcrumbs";
import { CardThumb } from "../CardThumb";
import { GradeChip } from "../GradeChip";
import type { IdentityDetail } from "@/lib/data/identityDetail";
import { identityDisplayName } from "@/lib/card/identity";
import { membershipLine } from "@/lib/card/identityView";

/**
 * Who this card is — the identity strip for /i/[...slug], in the venue page's
 * header shape: art, name, chips, one mono line.
 *
 * ⚠️ EVERY WORD HERE IS THE READER'S. The set chip is `parts.setName`, the grade
 * is `parts.grade` through the grade SSOT's chip, the crumb's set name comes
 * from the same parts (passed to Breadcrumbs as `names`, never typed), and the
 * membership line is counted from `tokens` and named by the index naming SSOT.
 *
 * The art is the best-resolved token's image through `/api/img` (CardThumb
 * routes every card image through the one proxy), in the slab's 5:7 frame; a
 * dead or missing image keeps the frame so the header never reflows.
 */
export function IdentityHeader({ detail }: { detail: IdentityDetail }) {
  const p = detail.parts;
  const art = detail.tokens.find((t) => t.image)?.image ?? null;
  const name = identityDisplayName(p.name);

  return (
    <header className="mb-3">
      <Breadcrumbs
        leaf={`${name} · ${p.grade}`}
        names={{
          ips: { [p.ip]: p.ipName },
          ...(p.setKey && p.setName ? { sets: { [`${p.ip}:${p.setKey}`]: p.setName } } : {}),
        }}
      />
      <div className="flex items-start gap-4">
        {/* `relative`: CardThumb's fill mode is absolute inset-0 — the frame owns
            the aspect ratio and the image fills it, whole (object-contain). */}
        <div className="relative aspect-[5/7] w-[72px] shrink-0 overflow-hidden rounded-md border border-line bg-bg-1 sm:w-[88px]">
          <CardThumb src={art} alt={name} fill className="p-0 [&>img]:p-1" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-none tracking-[-0.02em]">{name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
            {p.setKey && p.setName ? (
              <Link
                href={`/ip/${p.ip}/sets/${p.setKey}`}
                className="rounded-md border border-line bg-bg-1 px-2 py-1 text-ink-2 transition-colors hover:border-yellow/40 hover:text-yellow"
              >
                {p.setName}
              </Link>
            ) : null}
            {p.number ? (
              <span className="rounded-md border border-line bg-bg-1 px-2 py-1 font-mono text-ink-2">#{p.number}</span>
            ) : null}
            <GradeChip label={p.grade} />
            {p.edition ? (
              <span className="rounded-md border border-line bg-bg-1 px-2 py-1 text-ink-2">{p.edition}</span>
            ) : null}
            {p.language ? (
              <span className="rounded-md border border-line bg-bg-1 px-2 py-1 text-ink-2">{p.language}</span>
            ) : null}
          </div>
          <p className="mt-2 font-mono text-[11.5px] text-ink-3">{membershipLine(detail)}</p>
        </div>
      </div>
    </header>
  );
}
