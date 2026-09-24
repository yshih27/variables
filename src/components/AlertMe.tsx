"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { WATCH_BTN_RAIL } from "./WatchStar";
import { channelLabel, kindRule, kindsFor, kindLabel, maskEmail, type AlertChannel, type AlertEntityType, type AlertKind } from "@/lib/watch/alertView";
import { forgetAlertEmail, readAlertEmail, rememberPendingAlertEmail } from "@/lib/watch/alertEmail";

/**
 * "Alert me" — the star that writes. A sheet, not a page: one address, the
 * kinds that apply to this entity with their thresholds as receipt lines, the
 * channels this deployment can actually deliver on, one button.
 *
 * ⚠️ THE SHEET SAYS WHAT THE API SAID. The create answer is one sentence for
 * every address — new, pending or confirmed — so it never reveals which (the
 * backend's rule); the sheet prints that sentence, and an error is the API's
 * error, as a receipt line. Nothing here invents a success the server did not
 * report, or a state it chose not to disclose.
 *
 * ⚠️ ONLY CHANNELS THAT EXIST. `GET /api/alerts/channels` decides; Telegram is
 * offered only where the deployment has a bot.
 *
 * Below `lg` it is a bottom sheet (thumb reach); above, a centred dialog.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COMPACT =
  "inline-flex h-[30px] items-center gap-1.5 rounded-md border border-line bg-bg-1 px-2.5 font-mono text-[11.5px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60";

export type AlertEntity = { type: AlertEntityType; key: string; label: string };

export function AlertMe({ entity, variant = "compact" }: { entity: AlertEntity | null; variant?: "rail" | "compact" }) {
  const [open, setOpen] = useState(false);
  if (!entity) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        data-alert-me
        className={variant === "rail" ? `${WATCH_BTN_RAIL} border-line-2 bg-transparent text-ink hover:bg-bg-2` : COMPACT}
      >
        Alert me
      </button>
      {open && <AlertSheet entity={entity} onClose={() => setOpen(false)} />}
    </>
  );
}

type Phase = { s: "idle" } | { s: "sending" } | { s: "done"; message: string } | { s: "error"; message: string };

/** "big clear" → "Big clear" — sentence case, not CSS `capitalize` (which title-cases every word). */
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function AlertSheet({ entity, onClose }: { entity: AlertEntity; onClose: () => void }) {
  const kinds = kindsFor(entity.type);
  const [picked, setPicked] = useState<Set<AlertKind>>(() => new Set(kinds));
  const [remembered, setRemembered] = useState<string | null>(null);
  const [useOther, setUseOther] = useState(false);
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot, as on SubscribeForm
  const [channels, setChannels] = useState<AlertChannel[] | null>(null);
  const [channel, setChannel] = useState<AlertChannel>("email");
  const [phase, setPhase] = useState<Phase>({ s: "idle" });
  const dialogRef = useRef<HTMLDivElement>(null);

  // Storage and the channel list are read after mount — never during render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the remembered address can only be read in the browser
    setRemembered(readAlertEmail());
    const ctl = new AbortController();
    fetch("/api/alerts/channels", { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { channels?: Partial<Record<AlertChannel, string>> } | null) =>
        setChannels((["email", "telegram"] as const).filter((c) => c === "email" || b?.channels?.[c] === "available")),
      )
      .catch(() => {
        if (!ctl.signal.aborted) setChannels(["email"]);
      });
    dialogRef.current?.focus();
    return () => ctl.abort();
  }, []);

  const address = remembered && !useOther ? remembered : email.trim();

  const toggle = (k: AlertKind) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (phase.s === "sending") return;
    if (!EMAIL_RE.test(address)) {
      setPhase({ s: "error", message: "enter a valid email address" });
      return;
    }
    if (!picked.size) {
      setPhase({ s: "error", message: "pick at least one thing to watch for" });
      return;
    }
    setPhase({ s: "sending" });
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: address,
          entity_type: entity.type,
          entity_key: entity.key,
          kinds: kinds.filter((k) => picked.has(k)),
          channel,
          website,
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null;
      if (!res.ok || !body?.ok) {
        setPhase({ s: "error", message: body?.error ?? "the request did not go through; try again" });
        return;
      }
      // Parked, not remembered: it becomes this device's address only when its
      // confirmation lands here (alertEmail.ts).
      if (!remembered || useOther) rememberPendingAlertEmail(address);
      setPhase({ s: "done", message: body.message ?? "" });
    } catch {
      setPhase({ s: "error", message: "the request did not go through; try again" });
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center lg:items-center lg:p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Alerts for ${entity.label}`}
        tabIndex={-1}
        data-alert-sheet
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        className="scroll-y relative max-h-[88vh] w-full rounded-t-2xl border border-line-2 bg-bg-1 p-4 pb-6 font-sans shadow-[0_-12px_48px_rgba(0,0,0,0.55)] focus:outline-none sm:p-5 lg:max-w-[520px] lg:rounded-2xl lg:shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-2 lg:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold">Alert me</h2>
            <p className="mt-0.5 truncate font-mono text-[11.5px] text-ink-3">{entity.label}</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 font-mono text-[11px] text-ink-4 transition-colors hover:text-ink">
            close
          </button>
        </div>

        {phase.s === "done" ? (
          <div className="mt-4" data-alert-state="done">
            <p className="text-[14px] font-medium text-ink">
              <span className="text-yellow">✓</span> {phase.message}
            </p>
            <p className="mt-2 font-mono text-[11px] text-ink-4">
              {kinds.filter((k) => picked.has(k)).map(kindLabel).join(" · ")} · {channelLabel(channel).toLowerCase()}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 h-10 w-full rounded-lg border border-line-2 text-[13px] font-semibold text-ink transition-colors hover:bg-bg-2"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="mt-4">
            {/* Off-screen + non-focusable + no autofill: invisible to people. */}
            <div aria-hidden className="pointer-events-none absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden">
              <label>
                Website
                <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </label>
            </div>

            <fieldset>
              <legend className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">Tell me when</legend>
              <ul className="mt-2 space-y-1.5">
                {kinds.map((k) => (
                  <li key={k}>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-2 transition-colors hover:border-line-2">
                      <input
                        type="checkbox"
                        checked={picked.has(k)}
                        onChange={() => toggle(k)}
                        data-alert-kind={k}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-yellow"
                      />
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-medium text-ink">{sentence(kindLabel(k))}</span>
                        <span className="block font-mono text-[10.5px] text-ink-4">{kindRule(k, entity.type)}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>

            <div className="mt-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">Send to</p>
              {channels && channels.length > 1 ? (
                <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="Channel">
                  {channels.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={channel === c}
                      onClick={() => setChannel(c)}
                      data-alert-channel={c}
                      className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${channel === c ? "bg-yellow font-semibold text-black" : "bg-bg-2 text-ink-3 hover:text-ink"}`}
                    >
                      {channelLabel(c)}
                    </button>
                  ))}
                </div>
              ) : null}
              {remembered && !useOther ? (
                <p className="mt-2 font-mono text-[11.5px] text-ink-2" data-alert-remembered>
                  {maskEmail(remembered)} · confirmed on this device ·{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setUseOther(true);
                      forgetAlertEmail();
                    }}
                    className="text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                  >
                    use another
                  </button>
                </p>
              ) : (
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  aria-label="Email address"
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (phase.s === "error") setPhase({ s: "idle" });
                  }}
                  data-alert-email
                  className="mt-2 h-10 w-full rounded-lg border border-line bg-bg px-3 text-[13px] text-ink outline-none placeholder:text-ink-4 focus:border-yellow/60"
                />
              )}
              <p className="mt-1.5 font-mono text-[10.5px] text-ink-4">
                {channel === "telegram"
                  ? "the address confirms you; Telegram is linked from the manage page"
                  : "one digest per run, never an email per event · unsubscribe in every email"}
              </p>
            </div>

            <p className="mt-3 min-h-[16px] font-mono text-[11px] text-ink-3" data-alert-error aria-live="polite">
              {phase.s === "error" ? phase.message : ""}
            </p>
            <button
              type="submit"
              disabled={phase.s === "sending"}
              className="mt-1 h-10 w-full rounded-lg bg-yellow text-[13px] font-semibold text-black transition-colors hover:bg-yellow-2 disabled:opacity-60"
            >
              {phase.s === "sending" ? "Sending…" : "Watch"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
