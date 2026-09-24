/**
 * Email templates — plain, inline-styled HTML (email clients ignore <style>/CSS).
 * All dynamic text is HTML-escaped: card / IP names come from on-chain metadata and
 * can contain markup characters.
 *
 * The weekly email is a SUMMARY that links to the full /report page — we don't
 * reproduce the whole report in fragile email HTML; the page is the artifact.
 */
import type { WeeklyReport } from "../data/weeklyReport";
import { siteUrl } from "../site";
import { unsubscribeUrl, confirmUrl, manageUrl } from "./resend";
import { SITE_ORIGIN } from "../site";
import { digestSubject, eventLine, digestText } from "../alerts/render";
import type { Digest, FiredEvent } from "../alerts/signals";
import { cardHref } from "../card/ids";
import { receiptsHref } from "../indices/receiptRoute";

export type RenderedEmail = { subject: string; html: string; text: string };

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

const WRAP_OPEN = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;line-height:1.55">`;
const WRAP_CLOSE = `</div>`;

/** The brand pair: ink on white, and the lime the site's primary actions use. */
const INK = "#111";
const LIME = "#bfef01";

/**
 * Why this email arrived — said for the email it is. An alert email names the
 * alerts (and that the weekly comes with them, one unsubscribe for both); only
 * the weekly says "the weekly report".
 */
function footer(unsubUrl: string, why: "weekly" | "alerts" = "weekly"): string {
  const reason =
    why === "alerts"
      ? "You're receiving this because you set an alert on Varible. Unsubscribing stops your alerts and the weekly report."
      : "You're receiving this because you subscribed to the Varible weekly report.";
  return (
    `<hr style="border:0;border-top:1px solid #eee;margin:28px 0 14px">` +
    `<p style="font-size:12px;color:#888;margin:0">` +
    `${reason} ` +
    `<a href="${esc(unsubUrl)}" style="color:#888">Unsubscribe</a>.` +
    `</p>`
  );
}

/**
 * Double opt-in confirmation. Sent on signup; the CTA activates the subscription.
 * With `alert`, the signup came from an "Alert me" sheet: the email names the
 * watch it turns on, and says the weekly report comes with it (one list, one
 * unsubscribe; see the alerts PR for the product question).
 */
export function confirmationEmail(confirmToken: string, unsubscribeToken: string, alert?: { label: string }): RenderedEmail {
  const cUrl = confirmUrl(confirmToken);
  const uUrl = unsubscribeUrl(unsubscribeToken);
  const subject = alert ? `Confirm your Varible alert for ${alert.label}` : "Confirm your Varible weekly report subscription";
  const lead = alert
    ? `Tap below to turn on your alert for <strong>${esc(alert.label)}</strong>. You will also receive <strong>The Varible Weekly</strong> every Monday; one link unsubscribes from both.`
    : `Tap below to start receiving <strong>The Varible Weekly</strong>: prices, movers and the index for tokenized collectibles, every Monday.`;
  const html =
    WRAP_OPEN +
    `<h1 style="font-size:20px;font-weight:700;margin:0 0 8px">Confirm your subscription</h1>` +
    `<p style="margin:0 0 20px;color:#444">${lead}</p>` +
    `<p style="margin:0 0 24px"><a href="${esc(cUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Confirm subscription</a></p>` +
    `<p style="font-size:13px;color:#888;margin:0">If you didn't request this, you can ignore this email — nothing will be sent until you confirm. Or <a href="${esc(cUrl)}" style="color:#888">use this link</a>.</p>` +
    footer(uUrl) +
    WRAP_CLOSE;
  const text =
    `${subject}\n\n` +
    `Confirm: ${cUrl}\n\n` +
    `If you didn't request this, ignore this email — nothing is sent until you confirm.\n` +
    `Unsubscribe: ${uUrl}\n`;
  return { subject, html, text };
}

/** "Aug 2026" from an ISO month-end stamp. */
function monthLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Weekly report summary → links to the full /report page.
 *
 * ⚠️ LABELS ARE THE REPORT'S CONTRACT, NOT DECORATION (Sep 7 receipt check):
 *   • the week's total is "gacha + resale volume", never "tracked volume" (a
 *     reader assumes every dollar was a card changing hands; ~99% is packs);
 *   • the IP movers are RESALE only, and say so;
 *   • the biggest sale is "the largest resale we track", seller-received.
 * ⚠️ THE INDEX IS MONTHLY. `index.wowPct` is always null now; the headline is
 * month over month when the report week contains a month end, else the level
 * and the month it is as of, with the snapshot's own note. Never a bare "—".
 */
export function weeklyReportEmail(report: WeeklyReport, unsubscribeToken: string): RenderedEmail {
  const uUrl = unsubscribeUrl(unsubscribeToken);
  const reportUrl = siteUrl("/report");
  const week = report.weekStart.slice(0, 10);
  const idx = report.index;
  const topGainers = report.movers.ipVolume.gainers.slice(0, 3);
  const asOf = monthLabel(idx.asOf);

  const indexLine =
    idx.momPct != null
      ? `${idx.ticker} ${pct(idx.momPct)} month over month${asOf ? ` (${asOf})` : ""}`
      : idx.level != null
        ? `${idx.ticker} ${idx.level.toFixed(1)}${asOf ? ` as of ${asOf}` : ""}`
        : null;

  const subject = `The Varible Weekly, week of ${week}` + (idx.momPct != null ? `: ${idx.ticker} ${pct(idx.momPct)} month over month` : "");

  const moverRows = topGainers
    .map(
      (m) =>
        // Ink with the sign, not a green: the email keeps the brand pair, and a
        // "+" says up in every client, including the ones that strip colour.
        `<tr><td style="padding:4px 0;font-family:ui-monospace,monospace;font-size:13px">${esc(m.ticker ?? "")}</td>` +
        `<td style="padding:4px 0"><a href="${esc(siteUrl(`/ip/${m.key}`))}" style="color:#444">${esc(m.name)}</a></td>` +
        `<td style="padding:4px 0;text-align:right;color:${INK};font-weight:600">${pct(m.pct)}</td></tr>`,
    )
    .join("");

  const topSale = report.biggestSales[0];
  const saleDay = topSale ? topSale.date.slice(0, 10) : "";
  const saleHref = topSale ? cardHref(topSale.platform, topSale.tokenId) : "#";
  // The index level links to the month's receipts — the cards behind it.
  const indexHref = idx.asOf ? siteUrl(receiptsHref("market:total", idx.asOf)) : reportUrl;

  const html =
    WRAP_OPEN +
    `<p style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#888;margin:0 0 4px">The Varible Weekly · week of ${esc(week)}</p>` +
    (indexLine
      ? `<h1 style="font-size:22px;font-weight:700;margin:0 0 4px"><a href="${esc(indexHref)}" style="color:${INK};text-decoration:none">${esc(indexLine)}</a></h1>` +
        `<p style="font-size:12px;color:#888;margin:0 0 16px">${esc(idx.name)}, rebased to 100 at inception${idx.note ? `. ${esc(idx.note)}` : ""}</p>`
      : "") +
    `<table style="width:100%;border-collapse:collapse;margin:0 0 20px">` +
    // The change sits on its own line under the figure: on a phone the old
    // inline "(−30.6% week over week)" broke mid-phrase across two lines.
    `<tr><td style="padding:6px 12px 6px 0;color:#444;vertical-align:top">Gacha + resale volume, this week</td><td style="padding:6px 0;text-align:right;font-weight:600;white-space:nowrap;vertical-align:top">${usd(report.volume.weekUsd)}<span style="display:block;color:#888;font-weight:400;font-size:12px">${pct(report.volume.wowPct)} week over week</span></td></tr>` +
    `<tr><td style="padding:6px 12px 6px 0;color:#444;vertical-align:top">Market cap, end of week</td><td style="padding:6px 0;text-align:right;font-weight:600;white-space:nowrap;vertical-align:top">${usd(report.mcap.totalUsd)}<span style="display:block;color:#888;font-weight:400;font-size:12px">${pct(report.mcap.wowPct)} week over week</span></td></tr>` +
    `</table>` +
    (moverRows
      ? `<h2 style="font-size:14px;font-weight:700;margin:0 0 6px">Resale volume by IP, week over week</h2>` +
        `<table style="width:100%;border-collapse:collapse;margin:0 0 20px">${moverRows}</table>`
      : "") +
    (topSale
      ? `<p style="margin:0 0 20px;color:#444"><strong>Largest resale we track this week:</strong> <a href="${esc(siteUrl(saleHref))}" style="color:#444">${esc(topSale.name)}</a>, ${usd(topSale.priceUsd)} seller-received on ${esc(topSale.platformName)}, ${esc(saleDay)}</p>`
      : "") +
    `<p style="margin:0 0 8px"><a href="${esc(reportUrl)}" style="display:inline-block;background:${LIME};color:${INK};text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Read the full report</a></p>` +
    footer(uUrl) +
    WRAP_CLOSE;

  const text =
    `The Varible Weekly, week of ${week}\n\n` +
    (indexLine ? `${indexLine}\n${idx.name}, rebased to 100 at inception${idx.note ? `. ${idx.note}` : ""}\n\n` : "") +
    `Gacha + resale volume, this week: ${usd(report.volume.weekUsd)} (${pct(report.volume.wowPct)} week over week)\n` +
    `Market cap, end of week: ${usd(report.mcap.totalUsd)} (${pct(report.mcap.wowPct)} week over week)\n\n` +
    (topGainers.length
      ? `Resale volume by IP, week over week:\n${topGainers.map((m) => `  ${m.ticker ?? ""} ${m.name} ${pct(m.pct)}`).join("\n")}\n\n`
      : "") +
    (topSale ? `Largest resale we track this week: ${topSale.name}, ${usd(topSale.priceUsd)} seller-received on ${topSale.platformName}, ${saleDay}\n\n` : "") +
    `Full report: ${reportUrl}\n` +
    `Unsubscribe: ${uUrl}\n`;

  return { subject, html, text };
}

function manageFooter(manage: string, unsubUrl: string): string {
  return (
    `<p style="margin:20px 0 0;font-size:13px"><a href="${esc(manage)}" style="color:${INK}">Manage alerts →</a></p>` + footer(unsubUrl, "alerts")
  );
}

/**
 * "Your alert is on" — to a CONFIRMED reader who added a watch, and to a reader
 * who just confirmed with watches waiting. Carries the manage link; the API's
 * answer never says which of the two happened.
 */
export function alertOnEmail(input: { labels: string[]; manageToken: string; unsubscribeToken: string }): RenderedEmail {
  const m = manageUrl(input.manageToken);
  const u = unsubscribeUrl(input.unsubscribeToken);
  const n = input.labels.length;
  const subject = n === 1 ? `Watching ${input.labels[0]}` : `Watching ${n} alerts`;
  const html =
    WRAP_OPEN +
    `<h1 style="font-size:20px;font-weight:700;margin:0 0 8px">Your alert${n === 1 ? " is" : "s are"} on</h1>` +
    `<ul style="margin:0 0 16px;padding-left:18px;color:#444">${input.labels.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` +
    `<p style="margin:0;color:#444;font-size:14px">When one moves, you get one digest per run, never an email per event. Pause, resume or delete any watch from the manage page.</p>` +
    manageFooter(m, u) +
    WRAP_CLOSE;
  const text = `${subject}\n\n${input.labels.map((l) => `• ${l}`).join("\n")}\n\nManage alerts: ${m}\nUnsubscribe: ${u}\n`;
  return { subject, html, text };
}

/**
 * The alert digest: ONE email per reader per run. The subject names the count
 * and the biggest move; each event is one line with its figures, their windows
 * and sources, and a link to the page that computes them.
 */
export function alertDigestEmail(
  digest: Digest,
  input: { hrefOf: (e: FiredEvent) => string; manageToken: string; unsubscribeToken: string },
): RenderedEmail {
  const m = manageUrl(input.manageToken);
  const u = unsubscribeUrl(input.unsubscribeToken);
  const subject = digestSubject(digest);
  const abs = (href: string) => (href.startsWith("http") ? href : `${SITE_ORIGIN}${href}`);
  const html =
    WRAP_OPEN +
    `<p style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#888;margin:0 0 4px">Varible alerts</p>` +
    // The subject as the heading: a reader who opens the email sees the count
    // and the biggest move before the lines, as the inbox showed them.
    `<h1 style="font-size:18px;font-weight:700;margin:0 0 14px">${esc(subject)}</h1>` +
    digest.events
      .map(
        (e) =>
          `<p style="margin:0 0 14px;color:#222;font-size:14px">${esc(eventLine(e))} ` +
          `<a href="${esc(abs(input.hrefOf(e)))}" style="color:#111;white-space:nowrap">Open →</a></p>`,
      )
      .join("") +
    manageFooter(m, u) +
    WRAP_CLOSE;
  const text = digestText(digest, { hrefOf: (e) => abs(input.hrefOf(e)), manageUrl: m }) + `\nUnsubscribe: ${u}\n`;
  return { subject, html, text };
}
