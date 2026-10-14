import { SAME_CARD_BAND, SAME_CARD_MIN_N, type PriceGap, type SameCard } from "@/lib/data/venueInsights";
import { Section } from "./Section";

/**
 * Same card, other venues: what this venue's buyers paid against the same card
 * at the same grade sold on another venue in the same month (`venue-insights`,
 * built from the index's sale panel). A venue sees its own prices; only a view
 * across venues can set them against the same card elsewhere.
 *
 * ⚠️ NEUTRAL INK. Paying more for the same card is a fact about where it sells,
 * not good or bad news, so no green or red. Groups under SAME_CARD_MIN_N
 * comparisons are not published (venueInsights.ts), and prices are compared as
 * each venue records them, which the receipt says.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLong = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;

type Row = { label: string } & PriceGap;

export function SameCardElsewhere({
  venueName,
  data,
  names,
}: {
  venueName: string;
  data: SameCard | null | undefined;
  /** Venue key → display name. */
  names: Record<string, string>;
}) {
  if (!data?.all) return null;
  const rows: Row[] = [
    { label: "All cards sold elsewhere too", ...data.all },
    ...data.byLanguage.map((l) => ({ label: `${l.language} cards`, ...l })),
    ...data.byVenue.map((o) => ({ label: `Against ${names[o.venue] ?? o.venue}`, ...o })),
  ];
  const band = Math.round(SAME_CARD_BAND * 100);

  return (
    <Section
      id="same-card"
      className="scroll-mt-24 font-sans"
      title="Same card, other venues"
      readMe={`what ${venueName}'s buyers paid against the same card and grade sold on another venue in the same month`}
      subtitle={`${data.sharedIdentities.toLocaleString("en-US")} of the ${data.identities.toLocaleString("en-US")} cards sold here also sold elsewhere · ${monthLong(data.months[0])} – ${monthLong(data.months[data.months.length - 1])}`}
      flush
    >
      <div className="scroll-x">
        <table className="w-full min-w-[640px] border-collapse text-[13px]" data-same-card>
          <thead>
            <tr className="border-b border-line">
              <Th> </Th>
              <Th align="right">Comparisons</Th>
              <Th align="right">{venueName} ÷ elsewhere</Th>
              <Th align="right">{`Higher by ${band}%+`}</Th>
              <Th align="right">{`Lower by ${band}%+`}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.label} className="[&:last-child>td]:border-b-0">
                <Td className={i === 0 ? "font-semibold text-ink" : "text-ink-2"}>{r.label}</Td>
                <Td align="right" className="font-mono tabular text-ink-3">
                  {r.n.toLocaleString("en-US")}
                </Td>
                <Td align="right" className="font-mono tabular font-semibold text-ink">
                  {`${r.medianRatio.toFixed(2)}×`}
                </Td>
                <Td align="right" className="font-mono tabular text-ink-2">
                  {`${Math.round(r.higherPct)}%`}
                </Td>
                <Td align="right" className="font-mono tabular text-ink-2">
                  {`${Math.round(r.lowerPct)}%`}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] leading-snug text-ink-4" data-same-card-receipt>
        {`one comparison is one card at one grade in one month: ${venueName}'s median sale ÷ the other venues' median, then the median of those · groups under ${SAME_CARD_MIN_N} comparisons are not shown · prices as each venue records them (Renaiss: what the buyer paid)`}
      </p>
    </Section>
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

function Td({ children, align, className = "" }: { children: React.ReactNode; align?: "right"; className?: string }) {
  return (
    <td className={`whitespace-nowrap border-b border-line/60 px-4 py-3 ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}
