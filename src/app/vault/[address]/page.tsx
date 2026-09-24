import { redirect } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { Section } from "@/components/Section";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { getVaultValuation, type VaultValuation } from "@/lib/data/vault";
import { parseWalletAddress } from "@/lib/vault/address";
import { partialText, shortAddress, venuesReadFor } from "@/lib/vault/view";
import { VaultDoor } from "@/components/vault/VaultDoor";
import { VaultHeader } from "@/components/vault/VaultHeader";
import { VaultKpis } from "@/components/vault/VaultKpis";
import { VaultSplit } from "@/components/vault/VaultSplit";
import { VaultHoldingsTable } from "@/components/vault/VaultHoldingsTable";

/**
 * /vault/<address> — the statement. One read, `getVaultValuation`, server-side;
 * the address is public on-chain but the page is not an index of who holds
 * what, so it is never indexed and never cached as a page (the valuation's own
 * 10-minute cache is the only state).
 *
 * Every state is a real page, never the generic error:
 *   · not an address  → the door, pre-filled, saying why;
 *   · nothing tracked → the statement head + "no slabs from tracked venues",
 *                       with the venues that were read;
 *   · partial         → the statement, with its receipt line above the rows;
 *   · the read failed → the statement head + what failed and a way to retry.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ address: string }> };

export default async function VaultStatementPage({ params }: Props) {
  const { address: raw } = await params;
  const input = safeDecode(raw);
  const parsed = parseWalletAddress(input);
  const ticker = await buildMarketTicker();

  if (!parsed) {
    return (
      <>
        <NavBar ticker={ticker} />
        <div className="px-4 pt-6 pb-20 font-sans sm:px-8">
          <VaultDoor initial={input} />
        </div>
      </>
    );
  }
  // One URL per wallet: an EVM address is read lower-cased, so a checksummed
  // paste lands on the same page (and the same cache entry) as the plain one.
  if (parsed.address !== input) redirect(`/vault/${parsed.address}`);

  // Only the READ sits in the try; the page is built after it (JSX inside a
  // try/catch would not catch a render error anyway).
  let res: Awaited<ReturnType<typeof getVaultValuation>> | null = null;
  try {
    res = await getVaultValuation(parsed.address);
  } catch {
    res = null;
  }
  const failed = res === null;
  if (res && "error" in res) {
    return (
      <>
        <NavBar ticker={ticker} />
        <div className="px-4 pt-6 pb-20 font-sans sm:px-8">
          <VaultDoor initial={input} />
        </div>
      </>
    );
  }
  const v: VaultValuation | null = res;

  return (
    <>
      <NavBar ticker={ticker} />
      <div className="px-4 pt-6 pb-20 font-sans sm:px-8">
        {v ? (
          <>
            <VaultHeader address={v.address} chain={v.chain} asOf={v.asOf} method={v.method} venues={v.venues} />
            {v.totals.holdings === 0 ? (
              <EmptyVault chain={v.chain} venues={v.venues} partial={v.partial} />
            ) : (
              <div className="space-y-3">
                <VaultKpis v={v} />
                {/* §7 pair — which IPs ‖ which grades: two questions about the same
                    value, so they share a row; items-stretch (the grid default)
                    gives both frames one top and one bottom edge, each card
                    `fill`s with its note anchored to the foot. Stacks below lg. */}
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <VaultSplit kind="ip" groups={v.byIp} totalUsd={v.totals.atValue.usd} />
                  <VaultSplit kind="grade" groups={v.byGrade} totalUsd={v.totals.atValue.usd} />
                </div>
                <VaultHoldingsTable v={v} />
              </div>
            )}
          </>
        ) : failed ? (
          <>
            <VaultHeader address={parsed.address} chain={parsed.chain} asOf="" method="v4.2" />
            <Section title="Holdings" readMe="the chain read did not complete; nothing is shown as a total">
              <p className="font-mono text-[11.5px] text-ink-3" data-vault-failed>
                the read of {venuesReadFor(parsed.chain).map((x) => x.label).join(" and ")} did not answer ·{" "}
                <a href={`/vault/${parsed.address}`} className="text-ink-2 underline-offset-2 hover:text-yellow hover:underline">
                  read again →
                </a>
              </p>
            </Section>
          </>
        ) : null}
      </div>
    </>
  );
}

/** A wallet with nothing tracked is a result, not an error: say which venues were read. */
function EmptyVault({ chain, venues: read, partial }: { chain: VaultValuation["chain"]; venues: readonly string[]; partial: VaultValuation["partial"] }) {
  const all = venuesReadFor(chain);
  // The read's own list when it names one; the chain's registry list otherwise.
  const venues = read.length ? all.filter((x) => read.includes(x.platform)) : all;
  return (
    // ⚠️ "NOTHING HERE" IS ONLY SAID OF A READ THAT FINISHED. A read that stopped
    // early (a budget, the clock) found nothing *before it stopped*, which is not
    // the same claim, so the headline changes and the reason is printed.
    <Section
      title="Holdings"
      readMe={partial ? "no slabs found before the read stopped" : "no slabs from tracked venues in this wallet"}
    >
      <div data-vault-empty>
        <p className="font-mono text-[11.5px] text-ink-3">venues read at this address</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {venues.map((x) => (
            <li key={x.platform} className="rounded-md border border-line bg-bg-2 px-2 py-1 font-mono text-[11px] text-ink-2">
              {x.label} <span className="text-ink-4">· {x.chain}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 font-mono text-[10.5px] text-ink-4" data-vault-partial={partial ? "" : undefined}>
          {partial ? partialText(partial) : "a slab held on another venue, or in another wallet, will not show here"}
        </p>
      </div>
    </Section>
  );
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s).trim();
  } catch {
    return s.trim();
  }
}

export async function generateMetadata({ params }: Props) {
  const { address } = await params;
  const parsed = parseWalletAddress(safeDecode(address));
  return {
    title: parsed ? `${shortAddress(parsed.address)} · Vault · VARIBLE` : "Vault · VARIBLE",
    robots: { index: false, follow: false },
  };
}
