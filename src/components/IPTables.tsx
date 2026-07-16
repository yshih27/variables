import Link from "next/link";
import { GradeChip } from "./GradeChip";
import type { CardRow, SetRow } from "@/lib/data/fetchIP";
import { Section } from "./Section";
import { TableRowLink } from "./TableRowLink";
import { proxyImg } from "@/lib/img";
import { formatCompactUsd, formatCompactNumber, formatInt } from "@/lib/format";
import { cardHref, cardSupported } from "@/lib/card/ids";

const PLATFORM_LABEL: Record<string, string> = {
  beezie: "Beezie",
  "collector-crypt": "Collector Crypt",
};

/** Top Cards — handoff-styled table. 24h % isn't tracked per card yet → "—". */
export function IPTopCards({
  rows,
  seeAllHref,
  total,
}: {
  rows: CardRow[];
  seeAllHref: string;
  total: number;
}) {
  if (rows.length === 0) return null;
  return (
    <Section
      title="Top Cards"
      subtitle="Most traded in this window"
      right={<SeeAll href={seeAllHref} label={`See all ${total} →`} />}
      className="mb-12 font-sans"
      flush
    >
      <div className="scroll-x">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <Hr>
              <Th>#</Th>
              <Th left>Card</Th>
              <Th left>Grade</Th>
              <Th>Last</Th>
              <Th>Trades</Th>
              <Th>24h Vol</Th>
              <Th>24h %</Th>
            </Hr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const supported = cardSupported(r.platform);
              const sub = r.set ?? PLATFORM_LABEL[r.platform] ?? r.platform;
              const card = (
                <span className="flex items-center gap-3">
                  {r.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={proxyImg(r.image)}
                      alt=""
                      className="h-[42px] w-[30px] shrink-0 rounded-md bg-bg-2 object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="h-[42px] w-[30px] shrink-0 rounded-md bg-bg-2" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-semibold group-hover:text-yellow">{r.name}</span>
                    <span className="block truncate font-mono text-[11px] text-ink-4">{sub}</span>
                  </span>
                </span>
              );
              const cells = (
                <>
                  <Td className="text-ink-3">{String(r.rank).padStart(2, "0")}</Td>
                  <Td left>
                    {supported ? (
                      <Link href={cardHref(r.platform, r.tokenId)} className="block">
                        {card}
                      </Link>
                    ) : (
                      card
                    )}
                  </Td>
                  <Td left>
                    <GradeChip label={r.grade} />
                  </Td>
                  <Td strong>{formatCompactUsd(r.topPriceUsd)}</Td>
                  <Td>{formatInt(r.trades)}</Td>
                  <Td strong>{formatCompactUsd(r.vol24Usd)}</Td>
                  <Td muted>—</Td>
                </>
              );
              // Platforms without a card page have no href, so the row gets no click
              // handler and no cursor-pointer — it previously claimed both while the
              // stretched link it needed was never rendered.
              return supported ? (
                <TableRowLink
                  key={`${r.platform}:${r.tokenId}`}
                  href={cardHref(r.platform, r.tokenId)}
                  className="border-b border-line/60"
                >
                  {cells}
                </TableRowLink>
              ) : (
                <tr
                  key={`${r.platform}:${r.tokenId}`}
                  className="group border-b border-line/60 transition-colors hover:bg-bg-2"
                >
                  {cells}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** Sets — handoff-styled table. Set year isn't in our data → omitted. */
export function IPSets({
  rows,
  seeAllHref,
  total,
}: {
  rows: SetRow[];
  seeAllHref: string;
  total: number;
}) {
  if (rows.length === 0) return null;
  return (
    <Section
      title="Sets"
      subtitle={`Top sets by 24h volume · ${total} total`}
      right={<SeeAll href={seeAllHref} label={`See all ${total} →`} />}
      className="mb-12 font-sans"
      flush
    >
      <div className="scroll-x">
        <table className="w-full min-w-[680px] border-collapse text-[13px]">
          <thead>
            <Hr>
              <Th>#</Th>
              <Th left>Set</Th>
              <Th>Cards</Th>
              <Th>Trades</Th>
              <Th>24h Vol</Th>
              <Th>Avg Trade</Th>
              <Th left>Top Card</Th>
            </Hr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-b border-line/60 transition-colors hover:bg-bg-2">
                <Td className="text-ink-3">{String(r.rank).padStart(2, "0")}</Td>
                <Td left>
                  <span className="font-semibold">{r.name}</span>
                </Td>
                <Td>{formatCompactNumber(r.cards)}</Td>
                <Td>{formatInt(r.trades)}</Td>
                <Td strong>{formatCompactUsd(r.vol24Usd)}</Td>
                <Td muted>{formatCompactUsd(r.avgTradeUsd)}</Td>
                <Td left className="max-w-[260px]">
                  <span className="block truncate text-[12px] text-ink-2">{r.topCard ?? "—"}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}



function SeeAll({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-[12px] text-ink-3 transition-colors hover:text-yellow">
      {label}
    </Link>
  );
}

function Hr({ children }: { children: React.ReactNode }) {
  return (
    <tr className="border-b border-line font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
      {children}
    </tr>
  );
}

function Th({ children, left }: { children: React.ReactNode; left?: boolean }) {
  return <th className={`px-3 py-3 font-medium ${left ? "text-left" : "text-right"}`}>{children}</th>;
}

function Td({
  children,
  left,
  strong,
  muted,
  className = "",
}: {
  children: React.ReactNode;
  left?: boolean;
  strong?: boolean;
  muted?: boolean;
  className?: string;
}) {
  const align = left ? "text-left" : "text-right";
  const mono = left ? "" : "font-mono tabular";
  const weight = strong ? "font-semibold text-ink" : muted ? "text-ink-3" : "text-ink-2";
  return <td className={`whitespace-nowrap px-3 py-3.5 ${align} ${mono} ${weight} ${className}`}>{children}</td>;
}
