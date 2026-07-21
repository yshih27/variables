import { redirect } from "next/navigation";

/**
 * /privacy → Rarible's canonical Privacy Policy (legal directive 7/21; see
 * /terms for the same treatment). ⚠️ Flagged to legal: the retired draft
 * disclosed Varible-specific practices (Vercel/GA4 analytics, weekly-report
 * email signup, localStorage watchlist) that the parent policy may not cover —
 * restoring a supplemental page is one revert away if counsel wants it.
 */
export default function PrivacyRedirect(): never {
  redirect("https://rarible.com/privacy");
}
