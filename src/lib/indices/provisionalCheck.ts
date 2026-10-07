/**
 * INV-14: every index that published last month has a reading for this month.
 *
 * The provisional reading (identityIndex.ts → the blob's `provisional`) is what
 * keeps an index speaking between closes: the running month's step as a level
 * when it clears the floor, or a below-floor record that says how far it is
 * from one. An entity that published last month and has neither, or has one
 * older than a day, means the builder stopped producing it or stopped running —
 * the reader would then fall silent for up to a month with nothing saying why.
 *
 * Pure over the blob and the clock, so the test drives every branch.
 */

export const PROVISIONAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Blob = {
  generatedAt?: string;
  series?: Record<string, { ts: string }[]>;
  provisional?: Record<string, { month: string }>;
};

const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export function checkProvisionalFreshness(blob: Blob, nowMs: number = Date.now()): { checked: number; violations: string[]; running: string; last: string } {
  const now = new Date(nowMs);
  const running = ym(now);
  const last = ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const violations: string[] = [];
  let checked = 0;
  const ageMs = blob.generatedAt ? nowMs - Date.parse(blob.generatedAt) : Infinity;
  for (const [id, pts] of Object.entries(blob.series ?? {})) {
    // A grade premium is a ratio, not an index: it has no running step.
    if (id.startsWith("premium:") || !Array.isArray(pts) || !pts.length) continue;
    const newest = pts[pts.length - 1];
    if (newest.ts.slice(0, 7) !== last) continue; // did not publish last month
    checked++;
    const prov = blob.provisional?.[id];
    if (!prov) violations.push(`${id}: published ${last}, no ${running} reading`);
    else if (prov.month !== running) violations.push(`${id}: published ${last}, its reading is for ${prov.month}, not ${running}`);
    else if (!(ageMs <= PROVISIONAL_MAX_AGE_MS)) violations.push(`${id}: its ${running} reading is ${(ageMs / 3.6e6).toFixed(1)}h old (> 24h)`);
  }
  return { checked, violations, running, last };
}
