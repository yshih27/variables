import Link from "next/link";
import type { SetRow, GradeRow, CardRow } from "@/lib/data/fetchIP";
import { proxyImg } from "@/lib/img";
import { formatCompactUsd, formatCompactNumber, formatInt } from "@/lib/format";
import { cardHref, cardSupported } from "@/lib/card/ids";

type SectionProps = {
  title: string;
  sub?: string;
  seeAllHref?: string;
  totalRows?: number;
  visibleRows?: number;
  children: React.ReactNode;
};

// ─────────────────────────── Sets ────────────────────────────

export function SetsTable({
  rows,
  maxRows,
  seeAllHref,
}: {
  rows: SetRow[];
  maxRows?: number;
  seeAllHref?: string;
}) {
  if (rows.length === 0) return null;
  const visible = maxRows ? rows.slice(0, maxRows) : rows;
  return (
    <Section
      title="Sets"
      sub={`Top sets by 24h volume · ${rows.length} total`}
      seeAllHref={seeAllHref}
      totalRows={rows.length}
      visibleRows={visible.length}
    >
      <table className="w-full min-w-[900px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line">
            <Th>#</Th>
            <Th>Set</Th>
            <Th align="right">Cards</Th>
            <Th align="right">Trades</Th>
            <Th align="right">24h Vol</Th>
            <Th align="right">Avg Trade</Th>
            <Th>Top Card</Th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.name} className="transition-colors hover:bg-bg-2">
              <Td className="w-[44px] text-ink-3">{String(r.rank).padStart(2, "0")}</Td>
              <Td>
                <span className="font-semibold">{r.name}</span>
              </Td>
              <Td align="right">{formatCompactNumber(r.cards)}</Td>
              <Td align="right">{formatInt(r.trades)}</Td>
              <Td align="right" strong>
                {formatCompactUsd(r.vol24Usd)}
              </Td>
              <Td align="right" muted>
                {formatCompactUsd(r.avgTradeUsd)}
              </Td>
              <Td className="max-w-[280px] overflow-hidden text-ellipsis text-[12px] text-ink-2">
                {r.topCard ?? "—"}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

// ─────────────────────────── Grades ────────────────────────────

export function GradesTable({
  rows,
  maxRows,
  seeAllHref,
}: {
  rows: GradeRow[];
  maxRows?: number;
  seeAllHref?: string;
}) {
  if (rows.length === 0) return null;
  const visible = maxRows ? rows.slice(0, maxRows) : rows;
  return (
    <Section
      title="Grades"
      sub={`Distribution by grader and grade · last 24h`}
      seeAllHref={seeAllHref}
      totalRows={rows.length}
      visibleRows={visible.length}
    >
      <table className="w-full min-w-[700px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line">
            <Th>#</Th>
            <Th>Grade</Th>
            <Th align="right">Cards</Th>
            <Th align="right">Trades</Th>
            <Th align="right">24h Vol</Th>
            <Th align="right">Avg Trade</Th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.label} className="transition-colors hover:bg-bg-2">
              <Td className="w-[44px] text-ink-3">{String(r.rank).padStart(2, "0")}</Td>
              <Td>
                <GradePill grader={r.grader} gradeNum={r.gradeNum} label={r.label} />
              </Td>
              <Td align="right">{formatCompactNumber(r.cards)}</Td>
              <Td align="right">{formatInt(r.trades)}</Td>
              <Td align="right" strong>
                {formatCompactUsd(r.vol24Usd)}
              </Td>
              <Td align="right" muted>
                {formatCompactUsd(r.avgTradeUsd)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

const GRADER_COLOR: Record<string, string> = {
  PSA: "#D62828",
  CGC: "#5fa3ff",
  BGS: "#fdff8c",
  SGC: "#a18cff",
  AGS: "#6cf48a",
};

function GradePill({
  grader,
  gradeNum,
  label,
}: {
  grader: string | null;
  gradeNum: number | null;
  label: string;
}) {
  if (!grader || gradeNum == null) {
    return <span className="text-ink-2">{label}</span>;
  }
  const color = GRADER_COLOR[grader.toUpperCase()] ?? "#707070";
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-line bg-bg-2 px-2 py-1 text-[12px] font-bold tabular">
      <span style={{ color }}>{grader}</span>
      <span className="text-ink">{gradeNum}</span>
    </span>
  );
}

// ─────────────────────────── Top Cards ────────────────────────────

/** Card image + name cell; links to /card/[id] when that platform is supported. */
function CardCell({
  platform,
  tokenId,
  image,
  name,
}: {
  platform: string;
  tokenId: string;
  image?: string;
  name: string;
}) {
  const inner = (
    <>
      {image ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={proxyImg(image)}
          alt={name}
          className="h-9 w-7 rounded-sm object-cover"
          loading="lazy"
        />
      ) : (
        <div className="h-9 w-7 rounded-sm bg-bg-2" />
      )}
      <span className="max-w-[280px] overflow-hidden text-ellipsis font-semibold group-hover:text-yellow">
        {name}
      </span>
    </>
  );
  if (!cardSupported(platform)) {
    return <div className="flex items-center gap-3">{inner}</div>;
  }
  return (
    <Link href={cardHref(platform, tokenId)} className="group flex items-center gap-3">
      {inner}
    </Link>
  );
}

export function TopCardsTable({
  rows,
  maxRows,
  seeAllHref,
}: {
  rows: CardRow[];
  maxRows?: number;
  seeAllHref?: string;
}) {
  if (rows.length === 0) return null;
  const visible = maxRows ? rows.slice(0, maxRows) : rows;
  return (
    <Section
      title="Top Cards"
      sub={`Highest 24h volume cards · ${rows.length} total`}
      seeAllHref={seeAllHref}
      totalRows={rows.length}
      visibleRows={visible.length}
    >
      <table className="w-full min-w-[900px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line">
            <Th>#</Th>
            <Th>Card</Th>
            <Th>Set</Th>
            <Th>Grade</Th>
            <Th>Platform</Th>
            <Th align="right">Trades</Th>
            <Th align="right">24h Vol</Th>
            <Th align="right">Top Sale</Th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={`${r.platform}:${r.tokenId}`} className="transition-colors hover:bg-bg-2">
              <Td className="w-[44px] text-ink-3">{String(r.rank).padStart(2, "0")}</Td>
              <Td>
                <CardCell
                  platform={r.platform}
                  tokenId={r.tokenId}
                  image={r.image}
                  name={r.name}
                />
              </Td>
              <Td className="max-w-[220px] overflow-hidden text-ellipsis text-[12px] text-ink-2">
                {r.set ?? "—"}
              </Td>
              <Td>
                <span className="text-[12px] text-ink-2">{r.grade}</span>
              </Td>
              <Td muted>{r.platform === "beezie" ? "Beezie" : "Collector Crypt"}</Td>
              <Td align="right">{formatInt(r.trades)}</Td>
              <Td align="right" strong>
                {formatCompactUsd(r.vol24Usd)}
              </Td>
              <Td align="right" muted>
                {formatCompactUsd(r.topPriceUsd)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

// ─────────────────────────── Shared ────────────────────────────

function Section({
  title,
  sub,
  seeAllHref,
  totalRows = 0,
  visibleRows = 0,
  children,
}: SectionProps) {
  const overflow = totalRows - visibleRows;
  return (
    <section className="mt-12">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.005em]">{title}</h2>
          {sub && <div className="mt-1 text-[12px] text-ink-3">{sub}</div>}
        </div>
        {seeAllHref && overflow > 0 && (
          <Link
            href={seeAllHref}
            className="text-[12px] text-ink-3 transition-colors hover:text-yellow"
          >
            See all {totalRows} →
          </Link>
        )}
      </div>
      <div className="scroll-x">{children}</div>
    </section>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`px-4 py-3 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className = "",
  strong,
  muted,
}: {
  children: React.ReactNode;
  align?: "right";
  className?: string;
  strong?: boolean;
  muted?: boolean;
}) {
  const a = align === "right" ? "text-right" : "";
  const w = strong ? "font-semibold text-ink" : muted ? "text-ink-2" : "";
  return (
    <td
      className={`tabular whitespace-nowrap border-b border-line/60 px-4 py-3.5 ${a} ${w} ${className}`}
    >
      {children}
    </td>
  );
}
