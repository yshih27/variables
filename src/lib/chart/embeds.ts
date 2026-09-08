/**
 * Every chart id `/embed/[chart]` will serve.
 *
 * ⚠️ ONE LIST, TWO READERS — the route renders from it and the proxy validates
 * against it. An unknown id has to 404 for real, and a page that calls
 * `notFound()` after awaiting its data only ever produces a SOFT 404 (the
 * streamed 200 is already committed — see the note at the top of proxy.ts). So
 * the proxy rewrites first, and this list is what it checks.
 */
// "studio" = the Index Studio itself, bare, driven by the same #m=… hash it uses on
// /ips — the studio's own Embed button pointed at the PAGE URL, which the site-wide
// frame-ancestors 'self' policy now blocks, so it points here instead.
export const EMBED_CHARTS = ["market-volume", "resale-vs-gacha", "holders", "studio"] as const;

export type EmbedChartId = (typeof EMBED_CHARTS)[number];

export function isEmbedChartId(v: string): v is EmbedChartId {
  return (EMBED_CHARTS as readonly string[]).includes(v);
}
