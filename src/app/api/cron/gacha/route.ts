/**
 * Cron route: refresh the gacha snapshot.
 *
 * Invoked by the scheduler (Vercel Cron / GitHub Actions) with
 *   Authorization: Bearer <CRON_SECRET>
 * Runs the shared warmer, writes Postgres, then marks the gacha cache stale so
 * the /gacha page picks up fresh data on its next visit.
 *
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/gacha
 */
import { revalidateTag } from "next/cache";
import { runGachaWarm } from "@/lib/data/warmers/gacha";
import { runWarmer } from "@/lib/db/runWarmer";
import { cronAuthorized } from "@/lib/api/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Dune runQuery can take up to ~3 min per query

export async function GET(req: Request) {
  if (!cronAuthorized(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runWarmer("gacha-dune", () => runGachaWarm({ cachedOnly: false }));
    // Mark the gacha data stale (stale-while-revalidate on next visit).
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
