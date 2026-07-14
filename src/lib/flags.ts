/**
 * Feature flags.
 *
 * Mirrors the env-gate pattern already used for Google Analytics (NEXT_PUBLIC_GA_ID
 * in src/app/layout.tsx): a NEXT_PUBLIC_ var, inlined by Next at build time so the
 * same const resolves in BOTH server and client components.
 *
 * GACHA_ENABLED gates only the PUBLIC surfacing of the Gacha section — the nav link,
 * the /gacha route body, the homepage + platform entry links, the 404 pill, and the
 * sitemap entry. Default OFF: gacha is hidden from public view (protects the Rarible
 * pokemon_151 optics) while ALL gacha code stays in place and the warmers, crons, and
 * the aggregate gacha volume in market totals (homepage bar, /ips, /platforms, report)
 * keep running so the data stays warm.
 *
 * Relaunch later = set NEXT_PUBLIC_GACHA_ENABLED="true" and redeploy. Nothing to rebuild.
 */
export const GACHA_ENABLED = process.env.NEXT_PUBLIC_GACHA_ENABLED === "true";
