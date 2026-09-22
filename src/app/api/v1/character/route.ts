/**
 * GET /api/v1/character?ip=<ip>[&limit=N] — the character leaderboard of one IP.
 *
 * One row per character the extractor (src/lib/card/character.ts) found in the
 * IP's identities, ranked by 30d resale volume: identities, 30d sales and
 * volume, share of the IP's 30d resale volume (percent, from the same sale
 * panel — per character, not additive across characters, because a
 * multi-character card counts under each), and the latest published point of
 * the character index or null where it is gated. Read from the
 * `character-rollups` snapshot the indices batch writes; never built here.
 *
 * Query params:
 *   ip      pokemon | one_piece   (required — the IPs with an extractor)
 *   limit   1..500                (default 50)
 *
 * Auth: Authorization: Bearer <key> (or ?api_key=). Attribution required — see meta.terms.
 */
import { readCharacterLeaderboard } from "@/lib/data/characterRollups";
import { CHARACTER_IPS, hasCharacterExtractor } from "@/lib/card/character";
import { requireApiKey } from "@/lib/api/auth";
import { v1Ok, v1Error, v1Options } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

export const OPTIONS = v1Options;

const LIMIT_MAX = 500;

export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return v1Error(auth.status, auth.error);

  const url = new URL(req.url);
  const ip = url.searchParams.get("ip") ?? "";
  if (!hasCharacterExtractor(ip)) return v1Error(400, `ip must be one of ${CHARACTER_IPS.join(" | ")}`);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit == null || rawLimit === "" ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX) return v1Error(400, `limit must be an integer 1..${LIMIT_MAX}`);

  const rows = await readCharacterLeaderboard(ip, limit);
  return v1Ok(
    {
      ip,
      limit,
      window: "30d",
      shareNote: "shareOfIp30d is percent of the IP's 30d resale volume from the same sale panel; multi-character cards count under each character, so shares are not additive.",
      characters: rows,
    },
    auth,
  );
}
