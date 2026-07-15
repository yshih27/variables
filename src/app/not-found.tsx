import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { GACHA_ENABLED } from "@/lib/flags";

/**
 * Custom 404. Replaces Next.js's stark "404 This page could not be found."
 * default with on-brand copy + escape routes to the popular surfaces.
 */
export default function NotFound() {
  return (
    <>
      <NavBar />
      <main className="mx-auto flex min-h-[60vh] max-w-[640px] flex-col items-start justify-center px-8 pt-20 pb-16">
        <span className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-ink-3">
          404
        </span>
        <h1 className="mb-3 text-[44px] font-bold leading-[1.05] tracking-[-0.02em]">
          We couldn&apos;t find that.
        </h1>
        <p className="mb-8 text-[13.5px] leading-relaxed text-ink-2">
          The page may have moved, or you may be looking for a card we
          don&apos;t track yet. Here are some places that exist:
        </p>
        <div className="flex flex-wrap gap-2.5">
          <Pill href="/">Homepage</Pill>
          <Pill href="/ips">All IPs</Pill>
          <Pill href="/platforms">All Platforms</Pill>
          {GACHA_ENABLED && <Pill href="/gacha">Gacha</Pill>}
          <Pill href="/methodology">Methodology</Pill>
        </div>
      </main>
    </>
  );
}

function Pill({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-line/70 bg-bg-1 px-4 py-2 text-[13px] text-ink-2 hover:border-yellow/40 hover:text-yellow"
    >
      {children}
    </Link>
  );
}
