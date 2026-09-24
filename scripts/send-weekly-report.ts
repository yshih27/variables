/**
 * Weekly report broadcast — sends the composed weekly-report snapshot to every
 * CONFIRMED subscriber, each with its own RFC-8058 List-Unsubscribe headers.
 *
 *   npx tsx scripts/send-weekly-report.ts                  # DRY RUN (default): counts, sends nothing, writes nothing
 *   npx tsx scripts/send-weekly-report.ts --send           # send (the Monday job, once RESEND_API_KEY is set)
 *   npx tsx scripts/send-weekly-report.ts --send --limit 5 # cap recipients (a real test blast)
 *   … --html=<file>                                        # save one rendered email (a sample token)
 *   … --out=<dir>                                          # DRY RUN: write the ledger the send WOULD write to
 *                                                          #   <dir>/weekly-report-send:<week>.json (local only)
 *
 * ⚠️ IDEMPOTENT PER WEEK. `weekly-report-send:<weekStart>` (weeklySendLedger.ts)
 * records the subscriber ids sent to; a re-run skips them. Proof without a
 * production write: a dry run with `--out=<dir>`, then a second dry run with
 * `SNAPSHOT_LOCAL_DIR=<dir>`, which reads that ledger and skips everyone.
 *
 * ⚠️ FRESHNESS. A `--send` runs inside runWarmer("weekly-report-send"), rows =
 * recipients sent to this week, so a Monday without a send shows as stale in
 * check-freshness instead of passing silently. A dry run records nothing.
 *
 * ⚠️ PRIVACY. No address in any log line: counts, and a recipient's position in
 * the run when a send fails.
 *
 * Requires RESEND_API_KEY + EMAIL_FROM (a verified Resend domain). Without the key,
 * sendEmail logs instead of delivering — so a stray --send in dev can't email anyone.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readWeeklyReport } from "../src/lib/data/weeklyReport";
import { listConfirmedSubscribers } from "../src/lib/subscribe/subscribers";
import { weeklyReportEmail } from "../src/lib/email/templates";
import { sendEmail } from "../src/lib/email/resend";
import { readSendLedger, writeSendLedger, pendingRecipients, recordSent, ledgerKey } from "../src/lib/email/weeklySendLedger";
import { runWarmer } from "../src/lib/db/runWarmer";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Resend's default cap is 2 req/s — pace under it, and retry the odd 429/blip
// with backoff before counting a recipient as failed.
const SEND_INTERVAL_MS = 600;
const SEND_ATTEMPTS = 3;

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? null;

async function run(send: boolean): Promise<{ rowsWritten: number }> {
  const limitArg = process.argv.indexOf("--limit");
  let limit = Infinity;
  if (limitArg >= 0) {
    const raw = process.argv[limitArg + 1];
    const parsed = Number(raw);
    if (raw === undefined || !Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`--limit requires a positive integer, got: ${raw ?? "(nothing)"}`);
    }
    limit = parsed;
  }

  const report = await readWeeklyReport();
  if (!report) throw new Error("No weekly-report snapshot found — run scripts/warm-weekly-report.ts first.");

  const all = await listConfirmedSubscribers();
  let ledger = await readSendLedger(report.weekStart);
  const { pending, skipped } = pendingRecipients(all, ledger);
  const recipients = Number.isFinite(limit) ? pending.slice(0, limit) : pending;

  console.log(`Weekly report ${report.weekStart.slice(0, 10)} · ${report.index.ticker}`);
  console.log(
    `${all.length} confirmed recipient(s) · ${skipped} already sent this week (${ledgerKey(report.weekStart)}) · ${recipients.length} to send` +
      (Number.isFinite(limit) ? ` (capped at ${limit})` : ""),
  );

  const htmlOut = arg("html");
  if (htmlOut) {
    const sample = weeklyReportEmail(report, "SAMPLE_TOKEN");
    mkdirSync(dirname(htmlOut), { recursive: true });
    writeFileSync(htmlOut, sample.html);
    console.log(`  sample written → ${htmlOut} (subject "${sample.subject}")`);
  }

  if (!send) {
    const out = arg("out");
    if (out) {
      // What the ledger WOULD hold after this send — local only, for the proof.
      const now = new Date().toISOString();
      const would = recipients.reduce((l, r) => recordSent(l, r.id, now), ledger);
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `${ledgerKey(report.weekStart)}.json`), JSON.stringify(would));
      console.log(`  would-be ledger (${would.sent.length} ids) → ${join(out, `${ledgerKey(report.weekStart)}.json`)}`);
    }
    console.log(`\nDRY RUN — nothing sent, nothing written to production. Pass --send to deliver.`);
    return { rowsWritten: 0 };
  }

  let sent = 0;
  let failed = 0;
  let loggedOnly = 0;
  for (const [i, r] of recipients.entries()) {
    const mail = weeklyReportEmail(report, r.unsubscribeToken);
    const attempt = () =>
      sendEmail({ to: r.email, subject: mail.subject, html: mail.html, text: mail.text, unsubscribeToken: r.unsubscribeToken });
    let res = await attempt();
    for (let n = 2; !res.ok && n <= SEND_ATTEMPTS; n++) {
      await sleep(SEND_INTERVAL_MS * 2 ** (n - 1)); // backoff: 1.2s, 2.4s
      console.warn(`  ↻ recipient ${i + 1}/${recipients.length}: retry ${n}/${SEND_ATTEMPTS} after: ${res.error}`);
      res = await attempt();
    }
    if (!res.ok) {
      failed++;
      console.warn(`  ✗ recipient ${i + 1}/${recipients.length}: ${res.error}`);
    } else if (res.delivered) {
      sent++;
      // Recorded per send, so a run that dies halfway resumes where it stopped.
      ledger = recordSent(ledger, r.id, new Date().toISOString());
      await writeSendLedger(ledger);
    } else {
      loggedOnly++; // no API key — logged, not delivered, and NOT recorded as sent
    }
    await sleep(SEND_INTERVAL_MS);
  }
  console.log(`\nDone: ${sent} sent · ${failed} failed · ${loggedOnly} logged-only (no RESEND_API_KEY) · ${skipped} skipped (sent earlier this week).`);
  if (failed) throw new Error(`${failed} of ${recipients.length} sends failed`);
  return { rowsWritten: ledger.sent.length };
}

function main(): Promise<unknown> {
  const send = process.argv.includes("--send");
  // Only a real send is a freshness event; a dry run writes nothing anywhere.
  return send ? runWarmer("weekly-report-send", () => run(true)) : run(false);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
