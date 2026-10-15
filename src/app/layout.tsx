import type { Metadata } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { GoogleAnalytics } from "@next/third-parties/google";
import { AppShell } from "@/components/shell/AppShell";
import { SiteFooter } from "@/components/SiteFooter";
import { SHELL_V2 } from "@/lib/flags";
import { SITE_ORIGIN } from "@/lib/site";
import "./globals.css";

// ⚠️ SELF-HOSTED, NEVER next/font/google. Google Fonts refused Vercel's build
// servers on Oct 14 2026 and every production build failed on the download
// (module-not-found for each font file). These are the same files Google served
// for the subset we load, "latin": both are variable, so one file covers 400-700.
// Characters outside it fall back to the system face in the stacks in
// globals.css. Licence: SIL Open Font License (JetBrains Mono, Inter).
const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin.woff2",
  variable: "--font-jetbrains-mono",
  weight: "400 700",
  display: "swap",
  // A monospace face: an Arial-metric fallback would reflow the numbers while it loads.
  adjustFontFallback: false,
});

// Display / prose face (sans) — Inter, matching Rarible — paired with mono
// numbers. Exposed as --font-inter and wired to Tailwind's `font-sans`.
const inter = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-inter",
  weight: "400 700",
  display: "swap",
});

export const metadata: Metadata = {
  // Without a metadataBase, Next resolves the per-route opengraph-image.tsx URLs
  // against localhost (and warns at build); scrapers then can't fetch the card.
  metadataBase: new URL(SITE_ORIGIN),
  title: "VARIBLE · Tokenized Collectibles Market",
  description:
    "Real collectibles. Real prices. Indexed. Track prices, volume, and holders across tokenized-collectibles platforms.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // GA4 only when the id is configured (keeps dev/preview clean); never hardcoded.
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  return (
    <html lang="en" className={`${jetbrainsMono.variable} ${inter.variable}`} suppressHydrationWarning>
      <body>
        {/* ⚠️ THE SEAM. Flag OFF = byte-for-byte the layout this file has always
            been: pages render their own <NavBar/> and the footer sits after them.
            Flag ON = AppShell owns the chrome (and the footer, so it lands inside
            the content column rather than under the rail) and NavBar returns null.
            Nothing between these two branches is shared, so the old shell cannot
            rot while the new one is being built. */}
        {SHELL_V2 ? (
          <AppShell>{children}</AppShell>
        ) : (
          <>
            {children}
            <SiteFooter />
          </>
        )}
        <Analytics />
        {gaId && <GoogleAnalytics gaId={gaId} />}
      </body>
    </html>
  );
}
