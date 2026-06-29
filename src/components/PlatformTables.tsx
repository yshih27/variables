import Link from "next/link";
import type {
  PlatformIPRow,
  PlatformCardRow,
  RecentSaleRow,
} from "@/lib/data/fetchPlatform";
import { IPIcon } from "./IPIcon";
import { proxyImg } from "@/lib/img";
import { formatCompactUsd, formatCompactNumber, formatInt } from "@/lib/format";
import { cardHref, cardSupported } from "@/lib/card/ids";

const GRADER_COLOR: Record<string, string> = {
  PSA: "#D62828",
  CGC: "#5b9bff",
  BGS: "#f5c451",
  SGC: "#a18cff",
  AGS: "#6cf48a",
  TAG: "#a78bfa",
};

/** Grade chip — colored grader prefix + mono number (e.g. PSA 10). */
function GradePill({ grade }: { grade: string }) {
  const m = grade.match(/^([A-Za-z]+)\s*([\d.]+)$/);
  if (!m) return <span className="font-mono text-[12px] text-ink-3">{grade || "—"}</span>;
  const color = GRADER_COLOR[m[1].toUpperCase()] ?? "#707070";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-2 px-2 py-1 font-mono text-[11px] font-bold">
      <span style={{ color }}>{m[1]}</span>
      <span className="text-ink">{m[2]}</span>
    </span>
  );
}

type SectionProps = {
  title: string;
  sub?: string;
  seeAllHref?: string;
  totalRows?: number;
  visibleRows?: number;
  children: React.ReactNode;
};

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
    <section className="mb-12 font-sans">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-bold tracking-[-0.02em]">{title}</h2>
          {sub && <div className="mt-1 font-mono text-[12px] text-ink-3">{sub}</div>}
        </div>
        {seeAllHref && overflow > 0 && (
          <Link
            href={seeAllHref}
            className="shrink-0 font-mono text-[12px] text-ink-3 transition-colors hover:text-yellow"
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
      className={`px-4 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 ${
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
  const a = align === "right" ? "text-right font-mono tabular" : "text-left";
  const w = strong ? "font-semibold text-ink" : muted ? "text-ink-2" : "";
  return (
    <td
      className={`whitespace-nowrap border-b border-line/60 px-4 py-3.5 ${a} ${w} ${className}`}
    >
      {children}
    </td>
  );
}

// ─────────────────────────── IPs on platform ────────────────────────────

export function PlatformIPsTable({
  rows,
  maxRows,
  seeAllHref,
}: {
  rows: PlatformIPRow[];
  maxRows?: number;
  seeAllHref?: string;
}) {
  if (rows.length === 0) return null;
  const visible = maxRows ? rows.slice(0, maxRows) : rows;
  return (
    <Section
      title="Top IPs on this platform"
      sub={`24h breakdown · ${rows.length} IP${rows.length === 1 ? "" : "s"} active`}
      seeAllHref={seeAllHref}
      totalRows={rows.length}
      visibleRows={visible.length}
    >
      <table className="w-full min-w-[900px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line">
            <Th>#</Th>
            <Th>IP / Category</Th>
            <Th align="right">Cards</Th>
            <Th align="right">Holders</Th>
            <Th align="right">Buyers (24h)</Th>
            <Th align="right">24h Vol</Th>
            <Th align="right">Avg Trade</Th>
            <Th>Top Card</Th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr
              key={r.key}
              className="group relative cursor-pointer transition-colors hover:bg-bg-2"
            >
              <Td className="w-[44px] font-mono tabular text-ink-3">{String(r.rank).padStart(2, "0")}</Td>
              <Td>
                <Link
                  href={`/ip/${r.key}`}
                  className="flex items-center gap-3 before:absolute before:inset-0 before:content-['']"
                >
                  <IPIcon
                    name={r.name}
                    short={r.short}
                    color={r.color}
                    logo={r.logo}
                    iconBlendMode={r.iconBlendMode}
                    emoji={r.emoji}
                    size={32}
                  />
                  <span className="font-semibold group-hover:text-yellow">{r.name}</span>
                </Link>
              </Td>
              <Td align="right">{formatCompactNumber(r.cards)}</Td>
              <Td align="right">{formatInt(r.holders)}</Td>
              <Td align="right" muted>{formatInt(r.buyers24h)}</Td>
              <Td align="right" strong>{formatCompactUsd(r.vol24Usd)}</Td>
              <Td align="right" muted>{formatCompactUsd(r.avgTradeUsd)}</Td>
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

// ─────────────────────────── Top Cards ────────────────────────────

/** Wrap a card's image+name in a /card/[id] link when the platform is supported. */
function CardLink({
  platform,
  tokenId,
  children,
}: {
  platform: string;
  tokenId: string;
  children: React.ReactNode;
}) {
  if (!cardSupported(platform)) {
    return <div className="flex items-center gap-3">{children}</div>;
  }
  return (
    <Link href={cardHref(platform, tokenId)} className="group flex items-center gap-3">
      {children}
    </Link>
  );
}

export function PlatformTopCardsTable({
  rows,
  maxRows,
  seeAllHref,
}: {
  rows: PlatformCardRow[];
  maxRows?: number;
  seeAllHref?: string;
}) {
  if (rows.length === 0) return null;
  const visible = maxRows ? rows.slice(0, maxRows) : rows;
  return (
    <Section
      title="Top Cards"
      sub={`Highest 24h volume cards on this platform · ${rows.length} total`}
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
            <Th>IP</Th>
            <Th align="right">Trades</Th>
            <Th align="right">24h Vol</Th>
            <Th align="right">Top Sale</Th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.tokenId} className="transition-colors hover:bg-bg-2">
              <Td className="w-[44px] font-mono tabular text-ink-3">{String(r.rank).padStart(2, "0")}</Td>
              <Td>
                <CardLink platform={r.platform} tokenId={r.tokenId}>
                  {r.image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={proxyImg(r.image)}
                      alt={r.name}
                      className="h-9 w-7 rounded-sm object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-9 w-7 rounded-sm bg-bg-2" />
                  )}
                  <span className="max-w-[280px] overflow-hidden text-ellipsis font-semibold group-hover:text-yellow">
                    {r.name}
                  </span>
                </CardLink>
              </Td>
              <Td className="max-w-[220px] overflow-hidden text-ellipsis text-[12px] text-ink-2">
                {r.set ?? "—"}
              </Td>
              <Td>
                <GradePill grade={r.grade} />
              </Td>
              <Td>
                <Link
                  href={`/ip/${r.ipKey}`}
                  className="flex items-center gap-2 hover:text-yellow"
                >
                  <IPIcon
                    name={r.ipName}
                    short={r.ipShort}
                    color={r.ipColor}
                    logo={r.ipLogo}
                    iconBlendMode={r.ipIconBlendMode}
                    emoji={r.ipEmoji}
                    size={20}
                  />
                  <span className="text-[12px]">{r.ipName}</span>
                </Link>
              </Td>
              <Td align="right">{formatInt(r.trades)}</Td>
              <Td align="right" strong>{formatCompactUsd(r.vol24Usd)}</Td>
              <Td align="right" muted>{formatCompactUsd(r.topPriceUsd)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

// ─────────────────────────── Recent Sales ────────────────────────────

function shortAddr(addr: string): string {
  // Address is sometimes "ETHEREUM:0xabc…" or just an address; show last 6.
  const stripped = addr.replace(/^[A-Z]+:/, "");
  if (stripped.length <= 12) return stripped;
  return `${stripped.slice(0, 4)}…${stripped.slice(-4)}`;
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function RecentSalesTable({
  rows,
  maxRows,
  seeAllHref,
}: {
  rows: RecentSaleRow[];
  maxRows?: number;
  seeAllHref?: string;
}) {
  if (rows.length === 0) return null;
  const visible = maxRows ? rows.slice(0, maxRows) : rows;
  return (
    <Section
      title="Recent Sales"
      sub={`Chronological · ${rows.length} sale${rows.length === 1 ? "" : "s"} in last 24h`}
      seeAllHref={seeAllHref}
      totalRows={rows.length}
      visibleRows={visible.length}
    >
      <table className="w-full min-w-[900px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line">
            <Th>Time</Th>
            <Th>Card</Th>
            <Th>IP</Th>
            <Th align="right">Price</Th>
            <Th>Buyer</Th>
            <Th>Seller</Th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => (
            <tr
              key={`${r.tokenId}:${r.date}:${i}`}
              className="transition-colors hover:bg-bg-2"
            >
              <Td className="font-mono tabular text-ink-3">{timeAgo(r.date)}</Td>
              <Td>
                <CardLink platform={r.platform} tokenId={r.tokenId}>
                  {r.image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={proxyImg(r.image)}
                      alt={r.cardName ?? "card"}
                      className="h-9 w-7 rounded-sm object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-9 w-7 rounded-sm bg-bg-2" />
                  )}
                  <span className="max-w-[280px] overflow-hidden text-ellipsis text-[12.5px] font-medium group-hover:text-yellow">
                    {r.cardName ?? r.tokenId.slice(0, 12)}
                  </span>
                </CardLink>
              </Td>
              <Td>
                <Link href={`/ip/${r.ipKey}`} className="text-[12px] text-ink-2 hover:text-yellow">
                  {r.ipName}
                </Link>
              </Td>
              <Td align="right" strong>{formatCompactUsd(r.priceUsd)}</Td>
              <Td className="font-mono text-[11.5px] text-ink-2">{shortAddr(r.buyer)}</Td>
              <Td className="font-mono text-[11.5px] text-ink-3">{shortAddr(r.seller)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
