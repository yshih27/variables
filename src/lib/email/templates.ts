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
import { unsubscribeUrl, confirmUrl } from "./resend";

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

function footer(unsubUrl: string): string {
  return (
    `<hr style="border:0;border-top:1px solid #eee;margin:28px 0 14px">` +
    `<p style="font-size:12px;color:#888;margin:0">` +
    `You're receiving this because you subscribed to the Varible weekly report. ` +
    `<a href="${esc(unsubUrl)}" style="color:#888">Unsubscribe</a>.` +
    `</p>`
  );
}

/** Double opt-in confirmation. Sent on signup; the CTA activates the subscription. */
export function confirmationEmail(confirmToken: string, unsubscribeToken: string): RenderedEmail {
  const cUrl = confirmUrl(confirmToken);
  const uUrl = unsubscribeUrl(unsubscribeToken);
  const subject = "Confirm your Varible weekly report subscription";
  const html =
    WRAP_OPEN +
    `<h1 style="font-size:20px;font-weight:700;margin:0 0 8px">Confirm your subscription</h1>` +
    `<p style="margin:0 0 20px;color:#444">Tap below to start receiving <strong>The Varible Index</strong> weekly report — real card prices, market movers, and index performance.</p>` +
    `<p style="margin:0 0 24px"><a href="${esc(cUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Confirm subscription</a></p>` +
    `<p style="font-size:13px;color:#888;margin:0">If you didn't request this, you can ignore this email — nothing will be sent until you confirm. Or <a href="${esc(cUrl)}" style="color:#888">use this link</a>.</p>` +
    footer(uUrl) +
    WRAP_CLOSE;
  const text =
    `Confirm your Varible weekly report subscription\n\n` +
    `Confirm: ${cUrl}\n\n` +
    `If you didn't request this, ignore this email — nothing is sent until you confirm.\n` +
    `Unsubscribe: ${uUrl}\n`;
  return { subject, html, text };
}

/** Weekly report summary → links to the full /report page. */
export function weeklyReportEmail(report: WeeklyReport, unsubscribeToken: string): RenderedEmail {
  const uUrl = unsubscribeUrl(unsubscribeToken);
  const reportUrl = siteUrl("/report");
  const week = report.weekStart.slice(0, 10);
  const idx = report.index;
  const topGainers = report.movers.ipVolume.gainers.slice(0, 3);

  const subject = `The Varible Weekly — ${idx.ticker} ${pct(idx.wowPct)} (week of ${week})`;

  const moverRows = topGainers
    .map(
      (m) =>
        `<tr><td style="padding:4px 0;font-family:ui-monospace,monospace;font-size:13px">${esc(m.ticker ?? "")}</td>` +
        `<td style="padding:4px 0;color:#444">${esc(m.name)}</td>` +
        `<td style="padding:4px 0;text-align:right;color:#0a7d33;font-weight:600">${pct(m.pct)}</td></tr>`,
    )
    .join("");

  const topSale = report.biggestSales[0];

  const html =
    WRAP_OPEN +
    `<p style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#888;margin:0 0 4px">The Varible Weekly · week of ${esc(week)}</p>` +
    `<h1 style="font-size:22px;font-weight:700;margin:0 0 16px">${esc(idx.ticker)} ${pct(idx.wowPct)} <span style="font-weight:400;color:#888;font-size:15px">week over week</span></h1>` +
    `<table style="width:100%;border-collapse:collapse;margin:0 0 20px">` +
    `<tr><td style="padding:6px 0;color:#444">Tracked volume</td><td style="padding:6px 0;text-align:right;font-weight:600">${usd(report.volume.weekUsd)} <span style="color:#888;font-weight:400">(${pct(report.volume.wowPct)})</span></td></tr>` +
    `<tr><td style="padding:6px 0;color:#444">Market cap</td><td style="padding:6px 0;text-align:right;font-weight:600">${usd(report.mcap.totalUsd)} <span style="color:#888;font-weight:400">(${pct(report.mcap.wowPct)})</span></td></tr>` +
    `</table>` +
    (moverRows
      ? `<h2 style="font-size:14px;font-weight:700;margin:0 0 6px">Top movers by volume</h2>` +
        `<table style="width:100%;border-collapse:collapse;margin:0 0 20px">${moverRows}</table>`
      : "") +
    (topSale
      ? `<p style="margin:0 0 20px;color:#444"><strong>Biggest sale:</strong> ${esc(topSale.name)} — ${usd(topSale.priceUsd)}</p>`
      : "") +
    `<p style="margin:0 0 8px"><a href="${esc(reportUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Read the full report</a></p>` +
    footer(uUrl) +
    WRAP_CLOSE;

  const text =
    `The Varible Weekly — week of ${week}\n\n` +
    `${idx.ticker} ${pct(idx.wowPct)} WoW\n` +
    `Tracked volume ${usd(report.volume.weekUsd)} (${pct(report.volume.wowPct)})\n` +
    `Market cap ${usd(report.mcap.totalUsd)} (${pct(report.mcap.wowPct)})\n\n` +
    (topGainers.length
      ? `Top movers:\n${topGainers.map((m) => `  ${m.ticker} ${m.name} ${pct(m.pct)}`).join("\n")}\n\n`
      : "") +
    (topSale ? `Biggest sale: ${topSale.name} — ${usd(topSale.priceUsd)}\n\n` : "") +
    `Full report: ${reportUrl}\n` +
    `Unsubscribe: ${uUrl}\n`;

  return { subject, html, text };
}
