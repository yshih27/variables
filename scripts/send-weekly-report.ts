/**
 * Weekly report broadcast — sends the composed weekly-report snapshot to every
 * CONFIRMED subscriber, each with its own RFC-8058 List-Unsubscribe headers.
 *
 *   npx tsx scripts/send-weekly-report.ts            # DRY RUN (default): counts + sample, sends nothing
 *   npx tsx scripts/send-weekly-report.ts --send     # actually send
 *   npx tsx scripts/send-weekly-report.ts --send --limit 5   # cap recipients (a real test blast)
 *
 * NOT wired to cron on purpose — going live is a deliberate step (verified sending
 * domain + a retention decision). Wire it AFTER warm-weekly-report in the Monday
 * job when ready. Not idempotent: one --send per week (a re-run re-sends).
 *
 * Requires RESEND_API_KEY + EMAIL_FROM (a verified Resend domain). Without the key,
 * sendEmail logs instead of delivering — so a stray --send in dev can't email anyone.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readWeeklyReport } from "../src/lib/data/weeklyReport";
import { listConfirmedSubscribers } from "../src/lib/subscribe/subscribers";
import { weeklyReportEmail } from "../src/lib/email/templates";
import { sendEmail } from "../src/lib/email/resend";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Resend's default cap is 2 req/s — pace under it, and retry the odd 429/blip
// with backoff before counting a recipient as failed.
const SEND_INTERVAL_MS = 600;
const SEND_ATTEMPTS = 3;

async function main() {
  const send = process.argv.includes("--send");
  const limitArg = process.argv.indexOf("--limit");
  let limit = Infinity;
  if (limitArg >= 0) {
    const raw = process.argv[limitArg + 1];
    const parsed = Number(raw);
    if (raw === undefined || !Number.isInteger(parsed) || parsed <= 0) {
      console.error(`--limit requires a positive integer, got: ${raw ?? "(nothing)"}`);
      process.exit(1);
    }
    limit = parsed;
  }

  const report = await readWeeklyReport();
  if (!report) {
    console.error("No weekly-report snapshot found — run scripts/warm-weekly-report.ts first.");
    process.exit(1);
  }

  let recipients = await listConfirmedSubscribers();
  if (Number.isFinite(limit)) recipients = recipients.slice(0, limit);

  console.log(
    `Weekly report ${report.weekStart.slice(0, 10)} · ${report.index.ticker} ${report.index.wowPct?.toFixed(1) ?? "—"}% WoW`,
  );
  console.log(`${recipients.length} confirmed recipient(s)${Number.isFinite(limit) ? ` (capped at ${limit})` : ""}`);

  if (!send) {
    console.log(`\nDRY RUN — nothing sent. Pass --send to deliver.`);
    const sample = weeklyReportEmail(report, "SAMPLE_TOKEN");
    console.log(`  subject: "${sample.subject}"`);
    console.log(`  to (first 3): ${recipients.slice(0, 3).map((r) => r.email).join(", ") || "(none)"}`);
    return;
  }
  if (!recipients.length) {
    console.log("Nothing to send.");
    return;
  }

  let sent = 0;
  let failed = 0;
  let loggedOnly = 0;
  for (const r of recipients) {
    const mail = weeklyReportEmail(report, r.unsubscribeToken);
    let res = await sendEmail({
      to: r.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      unsubscribeToken: r.unsubscribeToken, // List-Unsubscribe + one-click headers
    });
    for (let attempt = 2; !res.ok && attempt <= SEND_ATTEMPTS; attempt++) {
      await sleep(SEND_INTERVAL_MS * 2 ** (attempt - 1)); // backoff: 1.2s, 2.4s
      console.warn(`  ↻ ${r.email}: retry ${attempt}/${SEND_ATTEMPTS} after: ${res.error}`);
      res = await sendEmail({
        to: r.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        unsubscribeToken: r.unsubscribeToken,
      });
    }
    if (!res.ok) {
      failed++;
      console.warn(`  ✗ ${r.email}: ${res.error}`);
    } else if (res.delivered) {
      sent++;
    } else {
      loggedOnly++; // no API key — logged, not delivered
    }
    await sleep(SEND_INTERVAL_MS);
  }
  console.log(`\nDone: ${sent} sent · ${failed} failed · ${loggedOnly} logged-only (no RESEND_API_KEY).`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
