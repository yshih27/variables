import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { VAULT_ENABLED } from "@/lib/flags";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { VaultDoor } from "@/components/vault/VaultDoor";

/**
 * /vault — the door: paste an address, read what it holds. No data read here;
 * the statement at /vault/<address> is where `getVaultValuation` runs.
 */
export const revalidate = 1800;

export const metadata = {
  title: "Vault · VARIBLE",
  description:
    "Paste a Solana, Polygon or Base address and read every tracked slab in it, valued by the same rule as its card page, with the n behind every total.",
};

export default async function VaultPage() {
  // Out of public view while VAULT_ENABLED is off (src/lib/flags.ts).
  if (!VAULT_ENABLED) notFound();
  return (
    <>
      <NavBar ticker={await buildMarketTicker()} />
      <div className="px-4 pt-6 pb-20 font-sans sm:px-8">
        <VaultDoor />
      </div>
    </>
  );
}
