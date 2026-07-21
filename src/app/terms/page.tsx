import { redirect } from "next/navigation";

/**
 * /terms → Rarible's canonical Terms of Service (legal directive 7/21: Varible
 * is governed by the parent policies; we don't maintain our own terms page).
 * The route stays so every existing link keeps working. The old draft lives in
 * git history (and docs/LEGAL-BRIEF.md) if counsel ever wants a supplement.
 */
export default function TermsRedirect(): never {
  redirect("https://rarible.com/terms");
}
