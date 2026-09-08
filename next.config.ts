import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: here,
  },
  /**
   * Framing policy.
   *
   * ⚠️ THE APP SENT NO FRAME HEADERS AT ALL BEFORE THIS, so every page was
   * embeddable by anyone. `/embed/*` exists to be framed and says so; everything
   * else is now same-origin only. SAMEORIGIN rather than DENY so any first-party
   * iframe keeps working, and `frame-ancestors` because X-Frame-Options is the
   * legacy header and CSP is what modern browsers actually enforce.
   */
  async headers() {
    return [
      {
        source: "/embed/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
          // No X-Frame-Options here on purpose: it has no "allow any origin"
          // value, and sending it would override the CSP above in older browsers.
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
      {
        source: "/:path((?!embed).*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
