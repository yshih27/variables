"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Root error boundary. Triggers on any uncaught exception during render
 * (Server or Client). Logs the error for the operator and gives the user
 * a "retry" + "go home" out instead of a white screen.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[variable] root error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-bg font-sans text-ink">
        <main className="mx-auto flex min-h-screen max-w-[560px] flex-col justify-center px-8">
          <span className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-red">
            Something broke
          </span>
          <h1 className="mb-3 text-[36px] font-bold leading-[1.1] tracking-[-0.02em]">
            We hit an error rendering this page.
          </h1>
          <p className="mb-1 text-[13.5px] leading-relaxed text-ink-2">
            Most often this is a stale cache or a rate-limited upstream
            (Helius / Etherscan). The operator&apos;s been notified.
          </p>
          {error.digest && (
            <p className="mb-6 text-[11.5px] text-ink-3">
              Error digest: <code className="rounded-md bg-bg-2 px-1.5 py-0.5">{error.digest}</code>
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => reset()}
              className="rounded-md bg-yellow px-4 py-2 text-[13px] font-semibold text-black hover:bg-yellow-2"
            >
              Try again
            </button>
            <Link
              href="/"
              className="rounded-md border border-line/70 px-4 py-2 text-[13px] text-ink-2 hover:text-ink"
            >
              Go home
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
