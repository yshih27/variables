"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { chainLabel, shortAddress, venuesReadText, type VaultChain } from "@/lib/vault/view";
import { rememberVaultAddress } from "@/lib/vault/recent";
import { dayShort } from "@/lib/card/identityView";

/**
 * The statement's head: whose vault (the address, short, with a copy of the
 * whole thing), which chains one paste was read on, and ONE receipt line — as
 * of when, by which method, on which venues.
 *
 * ⚠️ THE COPY IS THE FULL ADDRESS. The short form is for reading; a reader who
 * copies it is going to paste it somewhere, and `7GkP…2mQ4` pasted anywhere is
 * a wrong address.
 *
 * Mounting this is also what adds the address to the door's "looked up on this
 * device" list — in the browser, after mount, never on the server.
 */
export function VaultHeader({
  address,
  chain,
  asOf,
  method,
  venues,
}: {
  address: string;
  chain: VaultChain;
  asOf: string;
  method: string;
  /** What the read covered — the valuation's `venues`; absent when it never answered. */
  venues?: readonly string[] | null;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    rememberVaultAddress(address);
  }, [address]);
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); }, []);

  const copy = () => {
    const done = () => {
      setCopied(true);
      if (timer.current != null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    };
    navigator.clipboard?.writeText(address).then(done, done);
  };

  return (
    <header className="mb-3">
      <Link href="/vault" className="font-mono text-[11px] uppercase tracking-[0.07em] text-ink-3 transition-colors hover:text-yellow">
        Vault
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
        <h1 className="font-mono text-[22px] font-bold leading-none tracking-[-0.02em]" title={address} data-vault-address={address}>
          {shortAddress(address)}
        </h1>
        <button
          type="button"
          onClick={copy}
          data-copy-address
          aria-label="Copy the full address"
          className="rounded-md border border-line bg-bg-1 px-2 py-1 font-mono text-[11px] text-ink-3 transition-colors hover:border-line-2 hover:text-ink"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <span data-chain-chip className="rounded-md border border-line bg-bg-2 px-2 py-1 font-mono text-[11px] leading-none text-ink-2">
          {chainLabel(chain)}
        </span>
      </div>
      <p className="mt-2 font-mono text-[11.5px] text-ink-3" data-vault-receipt>
        as of {asOfText(asOf)} ·{" "}
        <Link href="/methodology" className="text-ink-2 underline-offset-2 transition-colors hover:text-yellow hover:underline">
          method {method}
        </Link>{" "}
        · read on {venuesReadText(chain, venues)}
      </p>
    </header>
  );
}

/** "Sep 24, 02:25 UTC" — the sale panel's own stamp, not the time of this visit. */
function asOfText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dayShort(iso)}, ${hh}:${mm} UTC`;
}
