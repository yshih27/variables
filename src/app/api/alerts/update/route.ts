/**
 * POST /api/alerts/update — { token, id, action: pause | resume | delete }.
 * The manage token is the only key: a watch is touched only when it belongs to
 * the token's reader. Unknown token → the neutral answer, 404.
 */
import { rateLimitInMemory } from "@/lib/api/auth";
import { subscriberByManageToken } from "@/lib/subscribe/subscribers";
import { updateWatch } from "@/lib/alerts/store";
import { parseUpdateInput, ALERT_LINK_UNKNOWN, ALERT_UPDATE_MESSAGE, NO_STORE } from "@/lib/alerts/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rl = rateLimitInMemory(req, { bucket: "alerts-manage", limit: 30, windowSec: 60 });
  if (!rl.ok) return Response.json({ ok: false, error: rl.error }, { status: 429, headers: NO_STORE });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400, headers: NO_STORE });
  }
  const p = parseUpdateInput(body);
  if (!p.ok) return Response.json({ ok: false, error: p.error }, { status: 400, headers: NO_STORE });
  try {
    const sub = await subscriberByManageToken(p.token);
    if (!sub) return Response.json({ ok: false, error: ALERT_LINK_UNKNOWN }, { status: 404, headers: NO_STORE });
    const done = await updateWatch(sub.id, p.id, p.action);
    if (!done) return Response.json({ ok: false, error: "That watch isn’t on this list." }, { status: 404, headers: NO_STORE });
    console.info(`[alerts] update ${p.action}`);
    return Response.json({ ok: true, message: ALERT_UPDATE_MESSAGE[p.action] }, { headers: NO_STORE });
  } catch (e) {
    console.warn(`[alerts] update failed: ${(e as Error).message}`);
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
