import { NavBar } from "@/components/NavBar";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { AlertsManager, AlertsNeutral } from "@/components/alerts/AlertsManager";
import { ALERT_LINK_UNKNOWN } from "@/lib/alerts/api";

/**
 * /alerts?token=… — manage your alerts. Reached ONLY by the link in an alert
 * email: the manage token is the key, there is no sign-in, and the page is
 * never linked from the nav, never indexed and never cached.
 *
 * ⚠️ NO ADDRESS ON THE PAGE. The link proves who is reading; printing the email
 * would only put it on a screen. A missing or unknown token renders the same
 * neutral page the confirm route does — it never says whether a token was
 * ever valid.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your alerts · VARIBLE",
  robots: { index: false, follow: false },
};

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const sp = await searchParams;
  const token = (Array.isArray(sp.token) ? sp.token[0] : sp.token)?.trim() ?? "";
  return (
    <>
      <NavBar ticker={await buildMarketTicker()} />
      <div className="px-4 pt-6 pb-20 font-sans sm:px-8">
        <div className="max-w-[920px]">{token ? <AlertsManager token={token} unknownMessage={ALERT_LINK_UNKNOWN} /> : <AlertsNeutral message={ALERT_LINK_UNKNOWN} />}</div>
      </div>
    </>
  );
}
