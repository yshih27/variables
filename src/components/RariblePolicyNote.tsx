/**
 * The "also governed by Rarible's policies" supplement note shown directly under
 * the draft notice on /terms and /privacy. Shared (not inlined per page) so the
 * two carry byte-identical copy and the external links can't drift apart. Both
 * links are external → new tab, with rel="noopener noreferrer".
 */
export function RariblePolicyNote() {
  return (
    <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
      Varible is a Rarible project. Use of this site is also governed by
      Rarible&apos;s{" "}
      <a
        href="https://rarible.com/terms"
        target="_blank"
        rel="noopener noreferrer"
        className="text-ink underline underline-offset-2 hover:text-yellow"
      >
        Terms of Service
      </a>{" "}
      and{" "}
      <a
        href="https://rarible.com/privacy"
        target="_blank"
        rel="noopener noreferrer"
        className="text-ink underline underline-offset-2 hover:text-yellow"
      >
        Privacy Policy
      </a>
      .
    </p>
  );
}
