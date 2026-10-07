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

/**
 * SHELL_V2 gates the terminal frame (docs/roadmap/brief-frontend-shell-v2.md):
 * the persistent left rail, the tape, the command palette, keyboard navigation
 * and the density mode — north-star Moves 1–4.
 *
 * Default OFF, exactly like GACHA_ENABLED: with the flag off `layout.tsx` is the
 * shell-less layout it has always been and every page keeps rendering its own
 * <NavBar/>. With it on, `AppShell` mounts from the layout and NavBar returns
 * null, so the per-page call sites never had to change and the old shell is one
 * env var away at all times.
 *
 * Flip = set NEXT_PUBLIC_SHELL_V2="true" in Vercel and redeploy (launch day, Sep 19).
 */
export const SHELL_V2 = process.env.NEXT_PUBLIC_SHELL_V2 === "true";

/**
 * VAULT_ENABLED and PRICE_CHIP_ENABLED gate two surfaces the owner has put out
 * of public view (Oct 7 2026): Varible presents itself as a comparison dashboard
 * with analytics, and "value a wallet" and "embed our price on your page" are
 * not part of that.
 *
 * Default OFF, the GACHA_ENABLED pattern: with VAULT_ENABLED off the Vault leaves
 * every navigation (rail, top bar, bottom tabs, command palette) and `/vault`,
 * `/vault/<address>` answer 404; with PRICE_CHIP_ENABLED off the "Get the chip"
 * action leaves identity pages. All code stays: the vault readers, the
 * `/embed/price/<slug>` chip, `/api/public/price/<slug>` and the badge keep
 * working for anything already pointing at them.
 *
 * Bring back = set NEXT_PUBLIC_VAULT_ENABLED / NEXT_PUBLIC_PRICE_CHIP_ENABLED to
 * "true" in Vercel and redeploy.
 */
export const VAULT_ENABLED = process.env.NEXT_PUBLIC_VAULT_ENABLED === "true";
export const PRICE_CHIP_ENABLED = process.env.NEXT_PUBLIC_PRICE_CHIP_ENABLED === "true";
