import Link from "next/link";
import { Breadcrumbs } from "../shell/Breadcrumbs";
import { CardThumb } from "../CardThumb";
import { GradeChip } from "../GradeChip";
import type { IdentityDetail } from "@/lib/data/identityDetail";
import { identityName, membershipParts } from "@/lib/card/identityView";
import { receiptsHref } from "@/lib/indices/receiptRoute";

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
  const name = identityName(p);

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
        {/* The hero frame: 144px wide (96 on phones), the slab trimmed whole. */}
        <CardThumb src={art} alt={name} variant="hero" />
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
          {/* ⚠️ EVERY INDEX NAMED HERE LINKS TO ITS RECEIPT for the month this
              card was counted in — the sample, the weights and the step. An
              index membership a reader cannot open is a claim with no receipt. */}
          <MembershipLine detail={detail} />
          {/* The hand-up to the character: this identity is one card of a
              character the reader named (the extractor on its own parts). */}
          {detail.character && (
            <Link
              href={detail.character.href}
              className="mt-1.5 inline-block font-mono text-[11.5px] text-ink-3 underline-offset-2 transition-colors hover:text-yellow hover:underline"
            >
              {detail.character.name} · every set and grade →
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function MembershipLine({ detail }: { detail: IdentityDetail }) {
  const { head, month, entities } = membershipParts(detail);
  if (!entities.length) {
    return <p className="mt-2 font-mono text-[11.5px] text-ink-3">{head} · in no published index this month</p>;
  }
  return (
    <p className="mt-2 font-mono text-[11.5px] text-ink-3">
      {head} · in the{" "}
      {entities.map((e, i) => (
        <span key={e.id}>
          {i > 0 ? (i === entities.length - 1 ? " and " : ", ") : ""}
          <Link
            href={receiptsHref(e.id, month)}
            title={`${e.name} index · the cards behind this month's step`}
            className="text-ink-2 underline-offset-2 transition-colors hover:text-yellow hover:underline"
          >
            {e.name}
          </Link>
        </span>
      ))}{" "}
      {entities.length === 1 ? "index" : "indices"} this month{" "}
      <Link
        href={receiptsHref(entities[0].id, month)}
        className="text-ink-3 underline-offset-2 transition-colors hover:text-yellow hover:underline"
      >
        receipts →
      </Link>
    </p>
  );
}
