import { readIndexProvisional } from "@/lib/data/indices";
import type { IndexEntity } from "@/lib/indices/naming";
import type { LevelSeries } from "@/components/indices/IndexLevelsChart";

/**
 * Attach each level series' running-month reading (its id is the blob's entity
 * id, `grade:psa-10`, `set:pokemon-151`), so the chart can draw it after the
 * last close. Server-side, with the page's other reads; never throws.
 */
export async function withProvisional(series: LevelSeries[]): Promise<LevelSeries[]> {
  return Promise.all(
    series.map(async (s) => {
      const i = s.id.indexOf(":");
      if (i <= 0) return s;
      // The same `from` the grade and set pages read their series with.
      const provisional = await readIndexProvisional(s.id.slice(0, i) as IndexEntity, s.id.slice(i + 1), { from: "2000-01-01" }).catch(() => null);
      return provisional ? { ...s, provisional } : s;
    }),
  );
}
