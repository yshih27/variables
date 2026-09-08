/**
 * Every chart id `/embed/[chart]` will serve.
 *
 * ⚠️ ONE LIST, TWO READERS — the route renders from it and the proxy validates
 * against it. An unknown id has to 404 for real, and a page that calls
 * `notFound()` after awaiting its data only ever produces a SOFT 404 (the
 * streamed 200 is already committed — see the note at the top of proxy.ts). So
 * the proxy rewrites first, and this list is what it checks.
 */
export const EMBED_CHARTS = ["market-volume", "resale-vs-gacha", "holders"] as const;

export type EmbedChartId = (typeof EMBED_CHARTS)[number];

export function isEmbedChartId(v: string): v is EmbedChartId {
  return (EMBED_CHARTS as readonly string[]).includes(v);
}
