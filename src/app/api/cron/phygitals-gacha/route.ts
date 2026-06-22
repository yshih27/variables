/**
 * Cron route: refresh the Phygitals gacha snapshot from the CLAW feed.
 *
 * Invoked by the scheduler (GitHub Actions / Vercel Cron) with
 *   Authorization: Bearer <CRON_SECRET>
 * Ingests this run's unique pulls into the gacha_pulls spine, recomputes odds/EV
 * from the accumulated window, writes the snapshot, then marks the gacha cache
 * stale so /gacha picks up fresh data on its next visit. Shares one warmer with
 * the CLI (scripts/warm-phygitals-gacha.ts).
 *
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/phygitals-gacha
 */
import { revalidateTag } from "next/cache";
import { runPhygitalsGachaWarm } from "@/lib/data/warmers/phygitalsGacha";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runPhygitalsGachaWarm({});
    // The Phygitals odds/hits are merged into the gacha payload — bust that tag.
    try {
      revalidateTag("gacha", "max");
    } catch {
      // revalidation is best-effort; the data is already written.
    }
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
