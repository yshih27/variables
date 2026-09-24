"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Section } from "../Section";
import { channelLabel, kindLabel, type AlertChannel, type AlertKind } from "@/lib/watch/alertView";
import { promotePendingAlertEmail } from "@/lib/watch/alertEmail";

/**
 * The manage page's body: every watch this manage token holds, one row each —
 * the entity (its label from the naming SSOTs, linked to its page), its kinds
 * as chips, the channel, whether it is paused — with pause / resume / delete
 * per row. (The manage payload carries no card art, so a row is text.)
 *
 * Every action goes through `POST /api/alerts/update` and the row shows what
 * the API returned, not what the click hoped for. Delete asks once, inline.
 */
/** One row of `GET /api/alerts?token=` (brief-backend-alerts.md). */
export type ManagedWatch = {
  id: string;
  entity_type: "identity" | "ip" | "platform";
  entity_key: string;
  label: string;
  href: string | null;
  kinds: AlertKind[];
  channel: AlertChannel;
  paused: boolean;
  created_at: string;
};

type Listing = {
  subscribed: boolean;
  channels: Partial<Record<AlertChannel, string>>;
  telegram: { linked: boolean };
  watches: ManagedWatch[];
};

/** `message` is the API's own neutral sentence (ALERT_LINK_UNKNOWN, passed from the server page). */
export function AlertsNeutral({ message }: { message: string }) {
  return (
    <div data-alerts-neutral>
      <h1 className="text-[22px] font-bold leading-none tracking-[-0.02em]">Your alerts</h1>
      <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-ink-2">{message}</p>
      <p className="mt-2 font-mono text-[11px] text-ink-4">every alert email carries your manage link</p>
      <Link href="/report" className="mt-4 inline-block font-mono text-[11.5px] text-ink-3 underline-offset-2 hover:text-yellow hover:underline">
        ← Go to the report
      </Link>
    </div>
  );
}

export function AlertsManager({ token, unknownMessage }: { token: string; unknownMessage: string }) {
  const [state, setState] = useState<{ s: "loading" } | { s: "neutral" } | { s: "ok"; data: Listing }>({ s: "loading" });

  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/alerts?token=${encodeURIComponent(token)}`, { signal: ctl.signal, cache: "no-store" })
      .then(async (r) => {
        const b = (await r.json().catch(() => null)) as ({ ok?: boolean } & Partial<Listing>) | null;
        if (r.ok && b?.ok && Array.isArray(b.watches)) {
          // A working manage link opened in THIS browser: the address the sheet
          // parked here is confirmed (see alertEmail.ts).
          promotePendingAlertEmail();
          setState({
            s: "ok",
            data: { subscribed: b.subscribed !== false, channels: b.channels ?? {}, telegram: { linked: !!b.telegram?.linked }, watches: b.watches },
          });
        } else setState({ s: "neutral" });
      })
      .catch(() => {
        if (!ctl.signal.aborted) setState({ s: "neutral" });
      });
    return () => ctl.abort();
  }, [token]);

  if (state.s === "neutral") return <AlertsNeutral message={unknownMessage} />;

  const watches = state.s === "ok" ? state.data.watches : [];
  const paused = watches.filter((w) => w.paused).length;
  const telegramAvailable = state.s === "ok" && state.data.channels.telegram === "available";

  return (
    <div>
      <h1 className="text-[22px] font-bold leading-none tracking-[-0.02em]">Your alerts</h1>
      <p className="mt-2 font-mono text-[11px] leading-snug text-ink-3">what this link watches; pause, resume or delete any</p>
      {state.s === "ok" && !state.data.subscribed ? (
        <p className="mt-2 font-mono text-[11px] text-ink-3" data-alerts-unsubscribed>
          unsubscribed · nothing is sent to this address until it subscribes again
        </p>
      ) : null}

      <Section
        className="mt-5"
        title="Watches"
        subtitle={
          state.s === "loading"
            ? "reading your watches…"
            : `${watches.length} watch${watches.length === 1 ? "" : "es"}${paused ? ` · ${paused} paused` : ""} · one digest per run`
        }
        flush
      >
        {state.s === "ok" && watches.length === 0 ? (
          <p className="px-4 py-3 font-mono text-[11px] text-ink-3 sm:px-5">no watches on this link · star a card and press Alert me to add one</p>
        ) : (
          <ul className="divide-y divide-line/60" data-alerts-rows>
            {watches.map((w) => (
              <WatchRow key={w.id} token={token} initial={w} telegramLinked={state.s === "ok" && state.data.telegram.linked} />
            ))}
          </ul>
        )}
        {telegramAvailable && state.s === "ok" ? <TelegramLink token={token} linked={state.data.telegram.linked} /> : null}
        <p className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] text-ink-4 sm:px-5" data-alerts-retention>
          unsubscribing from any alert email stops every watch on this link ·{" "}
          <a href="https://rarible.com/privacy" target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-ink-2 hover:underline">
            privacy
          </a>
        </p>
      </Section>
    </div>
  );
}

function WatchRow({ token, initial, telegramLinked }: { token: string; initial: ManagedWatch; telegramLinked: boolean }) {
  const [w, setW] = useState<ManagedWatch | null>(initial);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!w) {
    return (
      <li className="px-4 py-2.5 font-mono text-[11px] text-ink-4 sm:px-5" data-alert-row-deleted>
        deleted · {initial.label}
      </li>
    );
  }

  const act = async (action: "pause" | "resume" | "delete") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/alerts/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, id: w.id, action }),
      });
      const b = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; message?: string } | null;
      if (!res.ok || !b?.ok) {
        setError(b?.error ?? "that did not go through; try again");
        return;
      }
      // The API answered ok for exactly this action; the row now says so.
      if (action === "delete") setW(null);
      else setW({ ...w, paused: action === "pause" });
    } catch {
      setError("that did not go through; try again");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const channelText = w.channel === "telegram" ? (telegramLinked ? "Telegram · linked" : "Telegram · not linked yet") : channelLabel(w.channel);

  return (
    <li className={`flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5 ${w.paused ? "opacity-70" : ""}`} data-alert-row={w.id} data-paused={w.paused ? "1" : "0"}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0">
          {w.href ? (
            <Link href={w.href} className="block truncate text-[13px] font-semibold text-ink transition-colors hover:text-yellow">
              {w.label}
            </Link>
          ) : (
            <span className="block truncate text-[13px] font-semibold text-ink-2">{w.label}</span>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {w.kinds.map((k) => (
              <span key={k} className="rounded-md border border-line bg-bg-2 px-1.5 py-0.5 font-mono text-[10px] leading-none text-ink-3">
                {kindLabel(k)}
              </span>
            ))}
            <span className="font-mono text-[10.5px] text-ink-4">· {channelText}</span>
            {w.paused ? <span className="font-mono text-[10.5px] text-ink-3">· paused</span> : null}
          </div>
          {error ? <p className="mt-1 font-mono text-[10.5px] text-ink-3">{error}</p> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {confirmDelete ? (
          <>
            <span className="font-mono text-[10.5px] text-ink-3">delete this watch?</span>
            <RowButton onClick={() => act("delete")} disabled={busy} data="confirm-delete">delete</RowButton>
            <RowButton onClick={() => setConfirmDelete(false)} disabled={busy} data="keep">keep</RowButton>
          </>
        ) : (
          <>
            {w.paused ? (
              <RowButton onClick={() => act("resume")} disabled={busy} data="resume">resume</RowButton>
            ) : (
              <RowButton onClick={() => act("pause")} disabled={busy} data="pause">pause</RowButton>
            )}
            <RowButton onClick={() => setConfirmDelete(true)} disabled={busy} data="delete">delete</RowButton>
          </>
        )}
      </div>
    </li>
  );
}

function RowButton({ children, onClick, disabled, data }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; data: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-row-action={data}
      className="rounded-md border border-line px-2.5 py-1 font-mono text-[11px] text-ink-3 transition-colors hover:border-line-2 hover:text-ink disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/**
 * Link Telegram — only rendered where the deployment has a bot. The backend's
 * start route answers a one-time deep link; it is shown as a button (opens
 * Telegram) and as a line to copy (for a reader on another device).
 */
function TelegramLink({ token, linked }: { token: string; linked: boolean }) {
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [ttl, setTtl] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); }, []);

  if (linked) {
    return <p className="border-t border-line px-4 py-2.5 font-mono text-[11px] text-ink-3 sm:px-5" data-telegram-linked>Telegram · linked</p>;
  }

  const start = async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/alerts/telegram/start?token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const b = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; url?: string; expiresInMinutes?: number } | null;
      if (!r.ok || !b?.ok || !b.url) {
        setErr(b?.error ?? "Telegram linking is not available right now");
        return;
      }
      setLink(b.url);
      setTtl(b.expiresInMinutes ?? null);
    } catch {
      setErr("Telegram linking is not available right now");
    }
  };
  const copy = () => {
    if (!link) return;
    const done = () => {
      setCopied(true);
      if (timer.current != null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    };
    navigator.clipboard?.writeText(link).then(done, done);
  };

  return (
    <div className="border-t border-line px-4 py-3 sm:px-5" data-telegram>
      {link ? (
        <div className="flex flex-col gap-2">
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            data-telegram-open
            className="inline-flex h-9 w-fit items-center rounded-lg bg-yellow px-4 text-[12.5px] font-semibold text-black transition-colors hover:bg-yellow-2"
          >
            Open Telegram →
          </a>
          <div className="flex min-w-0 items-center gap-2">
            <code className="scroll-x min-w-0 flex-1 whitespace-nowrap rounded-md border border-line bg-bg px-2.5 py-1.5 font-mono text-[11px] text-ink-2" data-telegram-url>
              {link}
            </code>
            <button type="button" onClick={copy} data-telegram-copy className="shrink-0 rounded-md border border-line px-2.5 py-1.5 font-mono text-[11px] text-ink-3 transition-colors hover:text-ink">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="font-mono text-[10.5px] text-ink-4">
            one-time link{ttl ? ` · works for ${ttl} minutes` : ""} · press Start in the bot to finish
          </p>
        </div>
      ) : (
        <>
          <button type="button" onClick={start} data-telegram-start className="font-mono text-[11.5px] text-ink-2 underline-offset-2 transition-colors hover:text-yellow hover:underline">
            Link Telegram →
          </button>
          {err ? <p className="mt-1 font-mono text-[10.5px] text-ink-3">{err}</p> : null}
        </>
      )}
    </div>
  );
}
