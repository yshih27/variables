import type { Metadata } from "next";
import { JetBrains_Mono, Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { GoogleAnalytics } from "@next/third-parties/google";
import { SiteFooter } from "@/components/SiteFooter";
import { SITE_ORIGIN } from "@/lib/site";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Display / prose face (sans) — Inter, matching Rarible — paired with mono
// numbers. Exposed as --font-inter and wired to Tailwind's `font-sans`.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  // Without a metadataBase, Next resolves the per-route opengraph-image.tsx URLs
  // against localhost (and warns at build); scrapers then can't fetch the card.
  metadataBase: new URL(SITE_ORIGIN),
  title: "VARIBLE · Tokenized Collectibles Market",
  description:
    "Real cards. Real prices. Indexed. Track prices, volume, and holders across tokenized trading-card platforms.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // GA4 only when the id is configured (keeps dev/preview clean); never hardcoded.
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  return (
    <html lang="en" className={`${jetbrainsMono.variable} ${inter.variable}`}>
      <body>
        {children}
        <SiteFooter />
        <Analytics />
        {gaId && <GoogleAnalytics gaId={gaId} />}
      </body>
    </html>
  );
}
