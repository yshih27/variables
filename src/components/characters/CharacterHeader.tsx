import Link from "next/link";
import { Breadcrumbs } from "../shell/Breadcrumbs";
import { IPIcon } from "../IPIcon";
import type { CharacterDetail } from "@/lib/data/characterRollups";
import { IP_CATALOG } from "@/lib/data/ipCatalog";
import { characterLine, indexSummary } from "@/lib/card/characterView";

/**
 * Who this character is — the venue page's header shape: a mark, the name,
 * the IP chip, one mono line.
 *
 * ⚠️ EVERY WORD IS THE READER'S. The name is `detail.name` (the extractor's
 * display form), the IP chip is `detail.ipName`, the mono line is counted from
 * `identities` / `slabs` / `venues` / `bySet`, and the index clause appears
 * only when `index` is published. The crumb's leaf is the same name.
 *
 * The mark is the IP's catalog icon. The brief asked for the top identity's
 * token art; the rollup's `top[]` rows carry no image and no token id, and a
 * second reader for it would be a read the page is not allowed — flagged in
 * the PR rather than read around.
 */
export function CharacterHeader({ detail }: { detail: CharacterDetail }) {
  const ip = IP_CATALOG.find((i) => i.key === detail.ip) ?? null;
  const idx = indexSummary(detail);
  return (
    <header className="mb-3">
      <Breadcrumbs leaf={detail.name} names={{ ips: { [detail.ip]: detail.ipName } }} />
      <div className="flex items-start gap-3">
        <span className="shrink-0" aria-hidden>
          {ip ? (
            <IPIcon name={ip.name} short={ip.short} color={ip.color} logo={ip.logo} iconBlendMode={ip.iconBlendMode} emoji={ip.emoji} size={40} />
          ) : null}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] font-bold leading-none tracking-[-0.02em]">{detail.name}</h1>
            <Link
              href={`/ip/${detail.ip}`}
              className="rounded-md border border-line bg-bg-1 px-2 py-1 text-[12px] text-ink-2 transition-colors hover:border-yellow/40 hover:text-yellow"
            >
              {detail.ipName}
            </Link>
          </div>
          <p className="mt-2 font-mono text-[11.5px] text-ink-3">
            {characterLine(detail)}
            {idx ? <span className="text-ink-2"> · {idx}</span> : null}
          </p>
        </div>
      </div>
    </header>
  );
}
