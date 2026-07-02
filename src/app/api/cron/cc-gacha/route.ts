/**
 * Cron route: refresh Collector Crypt's native gacha data (gacha:cc).
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/cc-gacha
 *
 * Fetches the gacha app's machine catalog + winners feed, ingests pulls into
 * the gacha_pulls spine, writes the gacha:cc snapshot, then busts the gacha
 * cache tag. Run before /api/cron/gacha-packs (which reads the snapshot).
 */
import { revalidateTag } from "next/cache";
import { runCCGachaWarm } from "@/lib/data/warmers/ccGacha";
import { runWarmer } from "@/lib/db/runWarmer";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    const result = await runWarmer("cc-gacha", () => runCCGachaWarm());
    try {
      revalidateTag("gacha", "max");
    } catch {
      // best-effort
    }
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
