import { NavBar } from "@/components/NavBar";
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
  return (
    <>
      <NavBar ticker={await buildMarketTicker()} />
      <div className="px-4 pt-6 pb-20 font-sans sm:px-8">
        <VaultDoor />
      </div>
    </>
  );
}
