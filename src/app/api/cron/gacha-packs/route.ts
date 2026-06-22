/**
 * Cron route: refresh the cross-platform pack catalog (gacha:packs).
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/gacha-packs
 *
 * Re-fetches Beezie /claw + Phygitals /vm/chase, re-joins the realized pull
 * spine, writes the gacha:packs snapshot, then busts the gacha cache tag.
 */
import { revalidateTag } from "next/cache";
import { runGachaPacksWarm } from "@/lib/data/warmers/gachaPacks";

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
    const result = await runGachaPacksWarm();
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
