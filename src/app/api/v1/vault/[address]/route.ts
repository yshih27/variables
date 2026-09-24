/**
 * GET /api/v1/vault/<address>
 *
 * YOUR VAULT, VALUED — every tracked slab one wallet holds, each priced by the
 * rule its identity page publishes, under the keyed, attributed v1 envelope.
 *
 * The chain is detected from the address (`0x…` → Polygon + Base; base58 →
 * Solana), never asked. `value` is the identity's reference price (latest
 * complete-month median), else its last sale — never a floor. A read that
 * stopped early (a budget, the 20 s clock, the 2,000-holding cap) still
 * answers, with `partial: { reason, after }` saying what is missing.
 *
 *   400 — `invalid-address` (a mixed-case EVM address must pass EIP-55)
 *   200 — `holdings: []` for a wallet with nothing tracked: an empty vault is a
 *         result, not an error
 *
 * ⚠️ EVERY COLD CALL SPENDS THIRD-PARTY CREDITS (Helius, Rarible), so on top of
 * the per-key daily quota there is a per-IP bucket of 30 a minute. Results are
 * cached 10 minutes per (chain, address).
 *
 * ⚠️ PRIVACY: the log line carries the key's label and the chain, never the
 * address. Nothing is written anywhere.
 *
 * Auth: Authorization: Bearer <key> (or ?api_key=). Attribution required — see meta.terms.
 */
import { getVaultValuation } from "@/lib/data/vault";
import { requireApiKey, rateLimitInMemory } from "@/lib/api/auth";
import { v1Ok, v1Error, v1Options } from "@/lib/api/v1";
import { parseWalletAddress } from "@/lib/vault/address";

export const dynamic = "force-dynamic";

export const OPTIONS = v1Options;

const VAULT_RATE = { bucket: "vault", limit: 30, windowSec: 60 } as const;

export async function GET(req: Request, ctx: { params: Promise<{ address: string }> }) {
  // The free, in-memory check first: an abusive IP should not spend a key's quota write.
  const limited = rateLimitInMemory(req, VAULT_RATE);
  if (!limited.ok) return v1Error(429, limited.error);

  const auth = await requireApiKey(req);
  if (!auth.ok) return v1Error(auth.status, auth.error);

  const { address } = await ctx.params;
  let input: string;
  try {
    input = decodeURIComponent(address ?? "");
  } catch {
    return v1Error(400, "invalid-address");
  }
  const chain = parseWalletAddress(input)?.chain ?? "invalid";

  const t0 = Date.now();
  const vault = await getVaultValuation(input);
  if ("error" in vault) {
    console.info(`[api-v1] vault key=${auth.label} chain=${chain} → 400`);
    return v1Error(400, vault.error);
  }
  console.info(
    `[api-v1] vault key=${auth.label} chain=${chain} holdings=${vault.totals.holdings} partial=${vault.partial?.reason ?? "none"} ${Date.now() - t0}ms`,
  );
  return v1Ok(vault, auth);
}
