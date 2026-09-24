"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReadMe } from "../Section";
import { parseWalletAddress } from "@/lib/vault/address";
import { addressProblem, chainLabel, shortAddress } from "@/lib/vault/view";
import { forgetVaultAddress, parseVaultRecent, readVaultRecentRaw, subscribeVaultRecent } from "@/lib/vault/recent";

/**
 * /vault — the door. One input, one button; the chain is DETECTED as the reader
 * types (`parseWalletAddress`), never asked.
 *
 * ⚠️ A BAD INPUT IS A RECEIPT LINE, NOT A RED BANNER. The line under the input
 * says what the input is not ("an EVM address is 0x and 40 hex characters; this
 * has 38") so the reader can fix it; the button stays live and a submit of a bad
 * input only moves focus back to the field.
 *
 * `initial` + `reason` come from `/vault/<bad input>`: the statement route
 * renders this door, pre-filled, with the reason already showing.
 */
export const VAULT_INPUT_ID = "vault-address";

export function VaultDoor({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [tried, setTried] = useState(initial.length > 0);
  const parsed = useMemo(() => parseWalletAddress(value), [value]);
  const problem = parsed ? null : addressProblem(value);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!parsed) {
      document.getElementById(VAULT_INPUT_ID)?.focus();
      return;
    }
    router.push(`/vault/${parsed.address}`);
  };

  // The reason shows once the input is long enough to be judged, or after a
  // submit — not on the first keystroke of a paste-in-progress.
  const showProblem = problem && (tried || value.trim().length >= 32);

  return (
    <div className="max-w-[720px]">
      <h1 className="text-[22px] font-bold leading-none tracking-[-0.02em]">Vault</h1>
      <ReadMe className="mt-2">reads one address&apos;s slabs on tracked venues; stores nothing</ReadMe>

      <form onSubmit={onSubmit} className="mt-5" noValidate>
        <label htmlFor={VAULT_INPUT_ID} className="sr-only">
          Wallet address
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-bg-1 pl-3.5 pr-2 transition-colors focus-within:border-yellow/50">
            <input
              id={VAULT_INPUT_ID}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="a Solana, Polygon or Base address"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              inputMode="text"
              aria-invalid={showProblem ? true : undefined}
              aria-describedby="vault-address-note"
              className="h-11 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none placeholder:font-sans placeholder:text-ink-4"
            />
            {parsed ? (
              <span
                data-chain-chip
                className="shrink-0 rounded-md border border-line bg-bg-2 px-2 py-1 font-mono text-[10.5px] leading-none text-ink-2"
              >
                {chainLabel(parsed.chain)}
              </span>
            ) : null}
          </div>
          <button
            type="submit"
            className="h-11 shrink-0 rounded-xl bg-yellow px-5 text-[13px] font-semibold text-black transition-colors hover:bg-yellow-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
          >
            Value this wallet
          </button>
        </div>
        <p id="vault-address-note" data-address-note className="mt-2 min-h-[16px] font-mono text-[11px] leading-snug text-ink-4">
          {parsed ? (
            <>
              read on{" "}
              {parsed.chain === "solana" ? "Solana" : "Polygon and Base, one address space"} ·{" "}
              <span className="text-ink-3">{shortAddress(parsed.address)}</span>
            </>
          ) : showProblem ? (
            <span className="text-ink-3">not an address · {problem}</span>
          ) : (
            "paste only; no wallet connection, nothing signed"
          )}
        </p>
      </form>

      <RecentAddresses />
    </div>
  );
}

function RecentAddresses() {
  const raw = useSyncExternalStore(subscribeVaultRecent, readVaultRecentRaw, () => "[]");
  const list = useMemo(() => parseVaultRecent(raw), [raw]);
  if (!list.length) return null;
  return (
    <section className="mt-8" aria-labelledby="vault-recent">
      <h2 id="vault-recent" className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">
        Looked up on this device
      </h2>
      <ul className="mt-2 divide-y divide-line/60 rounded-xl border border-line bg-bg-1" data-vault-recent>
        {list.map((a) => {
          const p = parseWalletAddress(a);
          return (
            <li key={a} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <Link href={`/vault/${a}`} className="flex min-w-0 items-center gap-2.5 font-mono text-[12.5px] text-ink transition-colors hover:text-yellow">
                <span className="truncate">{shortAddress(a)}</span>
                {p ? <span className="font-mono text-[10.5px] text-ink-4">{chainLabel(p.chain)}</span> : null}
              </Link>
              <button
                type="button"
                onClick={() => forgetVaultAddress(a)}
                aria-label={`Remove ${shortAddress(a)} from this device`}
                className="shrink-0 font-mono text-[11px] text-ink-4 transition-colors hover:text-ink"
              >
                remove
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 font-mono text-[10.5px] text-ink-4">kept in this browser only, the last five</p>
    </section>
  );
}
