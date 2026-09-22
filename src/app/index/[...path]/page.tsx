import { notFound } from "next/navigation";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { Breadcrumbs } from "@/components/shell/Breadcrumbs";
import { StatCard, StatCardRow } from "@/components/StatCard";
import { ReceiptsTable } from "@/components/indices/ReceiptsTable";
import { MethodLine } from "@/components/indices/MethodLine";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { readIndexReceipts, readIndexMonths } from "@/lib/data/indexReceipts";
import { readMethodChanges } from "@/lib/data/methodChanges";
import { entityIdFromPath, isReceiptMonth, receiptsHref } from "@/lib/indices/receiptRoute";
import { labelFor } from "@/lib/indices/entityLabels";

/**
 * `/index/<entity>/<month>` — the receipt for one published month.
 *
 * ⚠️ A LEVEL IS A CLAIM, AND THIS IS WHERE IT IS CHECKED. "V-MKT was 159.2 in
 * August" is worth what a reader can verify: the step, the identities behind
 * it, both of each one's prices and both sale counts, and the estimator named.
 * Every published point on every index chart links here, so no index number on
 * the site is more than one click from its sample.
 *
 * ⚠️ A WITHHELD MONTH RENDERS THE SAME HEADER AND THE GATE'S REASON. The months
 * that did not publish are the ones a sceptic asks about; `readIndexReceipts`
 * carries the gate that held each, and this page prints it where the table
 * would be. That is the page's whole point — a hold with no explanation is
 * indistinguishable from a bug.
 *
 * One read: `readIndexReceipts` (the price-index blob) plus the method ledger
 * the line under every chart already reads, and — only to name the neighbouring
 * months — the entity's own published series from the same blob.
 */
export const revalidate = 1800;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (m: string) => `${MON[Number(m.slice(5, 7)) - 1] ?? m} ${m.slice(0, 4)}`;

function parsePath(path: string[]): { entityId: string; month: string } | null {
  const segs = (path ?? []).map((s) => decodeURIComponent(s));
  if (segs.length < 2) return null;
  const month = segs[segs.length - 1];
  if (!isReceiptMonth(month)) return null;
  const entityId = entityIdFromPath(segs.slice(0, -1));
  return entityId ? { entityId, month } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const parsed = parsePath(path);
  if (!parsed) return { title: "Not found · VARIBLE" };
  const label = labelFor(parsed.entityId);
  return {
    title: `${label.ticker} · ${monthName(parsed.month)} receipts · VARIBLE`,
    description: `Every card behind the ${label.name} index's ${monthName(parsed.month)} step — both prices, both sale counts, and the weight each carried.`,
  };
}

export default async function IndexReceiptsPage({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const parsed = parsePath(path);
  if (!parsed) notFound();

  const [receipts, months, ledger, ticker] = await Promise.all([
    readIndexReceipts(parsed.entityId, parsed.month),
    readIndexMonths(parsed.entityId),
    readMethodChanges(),
    buildMarketTicker(),
  ]);
  // Null means the entity publishes no series at all — nothing to explain.
  if (!receipts) notFound();

  const label = labelFor(parsed.entityId);
  // The neighbouring months — withheld ones included, since a reader following
  // a chain wants to land on the hold that explains the gap.
  const at = months.findIndex((m) => m.month === parsed.month);
  const prev = at > 0 ? months[at - 1].month : null;
  const next = at >= 0 && at < months.length - 1 ? months[at + 1].month : null;

  const held = receipts.held;
  const step = receipts.step;

  return (
    <>
      <NavBar ticker={ticker} />
      <div className="px-8 pt-6 pb-20 font-sans">
        <header className="mb-3">
          <Breadcrumbs />
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-[20px] font-bold leading-none tracking-[-0.01em]">
              {label.name} index · {monthName(parsed.month)}
            </h1>
            <span className="font-mono text-[12px] text-ink-3">{label.ticker}</span>
            {ledger.current ? (
              <span className="font-mono text-[11.5px] text-ink-4">method {ledger.current.version}</span>
            ) : null}
          </div>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-3">
            {held
              ? "This month did not publish. The gate that held it, and what it would have taken to clear, are below."
              : "Every card priced in both this month and the one before it, with the weight it carried into the step."}{" "}
            <Link href="/methodology#index-bias" className="text-ink-2 underline-offset-2 hover:text-yellow hover:underline">
              How the index is built →
            </Link>
          </p>
        </header>

        <div className="space-y-3">
          <StatCardRow cols={4}>
            <StatCard
              label="Level"
              value={receipts.level != null ? receipts.level.toFixed(1) : "—"}
              sub={receipts.level != null ? "100 = the index's base month" : "no level published for this month"}
              accent={receipts.level != null}
            />
            <StatCard
              label="Step"
              value={step != null ? `${step >= 0 ? "+" : ""}${step.toFixed(2)}%` : "—"}
              tone={step}
              sub={
                step != null
                  ? receipts.spansMonths && receipts.spansMonths > 1
                    ? `spans ${receipts.spansMonths} months — the months between were withheld`
                    : "the weighted median of the returns below"
                  : "no step — nothing chained into this month"
              }
            />
            <StatCard
              label="Identities in the step"
              value={receipts.identities.length ? String(receipts.identities.length) : "—"}
              sub={receipts.identities.length ? "priced in both months" : held ? "the gate below says why" : "the sample was not recorded"}
            />
            <StatCard
              label="Estimator"
              value={receipts.thin ? "thin" : "standard"}
              sub={receipts.estimator}
            />
          </StatCardRow>

          {held ? (
            <section className="rounded-2xl border border-line bg-bg-1 px-5 py-5">
              <h2 className="text-[16px] font-bold leading-tight tracking-[-0.01em] text-ink">Withheld · {held.reason}</h2>
              <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-ink-2">{held.detail}</p>
              <p className="mt-3 font-mono text-[11px] text-ink-4">
                a withheld month is not a zero and not a flat line — the chain simply does not advance, and the next
                published point says how many months it spans
              </p>
            </section>
          ) : receipts.identities.length ? (
            <ReceiptsTable identities={receipts.identities} month={monthName(parsed.month)} />
          ) : (
            <section className="rounded-2xl border border-line bg-bg-1 px-5 py-5">
              <h2 className="text-[16px] font-bold leading-tight tracking-[-0.01em] text-ink">No sample recorded</h2>
              <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-ink-2">
                This point published before the receipts were part of the blob, or this series is not chained on
                identities. The level above is what the builder wrote; the cards behind it were not recorded.
              </p>
            </section>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] text-ink-4">
            {prev ? (
              <Link href={receiptsHref(parsed.entityId, prev)} className="transition-colors hover:text-yellow">
                ← {monthName(prev)}
              </Link>
            ) : null}
            {next ? (
              <Link href={receiptsHref(parsed.entityId, next)} className="transition-colors hover:text-yellow">
                {monthName(next)} →
              </Link>
            ) : null}
            {label.href ? (
              <Link href={label.href} className="transition-colors hover:text-yellow">
                {label.name} →
              </Link>
            ) : null}
          </div>

          <MethodLine ledger={ledger} />
        </div>
      </div>
    </>
  );
}
