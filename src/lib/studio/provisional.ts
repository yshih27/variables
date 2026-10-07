import { readIndexProvisional, type IndexProvisional } from "@/lib/data/indices";
import type { IndexEntity } from "@/lib/indices/naming";
import { seedActiveFor, type StudioSeed } from "./seed";
import type { StudioScope } from "./catalog";

/**
 * The running month's reading for every index line a studio paints on its FIRST
 * render — read on the server with the page, so the provisional is drawn from
 * the start rather than arriving with the catalog bundle a moment later (and
 * fresher than a seed snapshot written before it existed). Lines added later
 * get theirs from the bundle. Never throws: no reading, no dashed segment.
 */
export async function readStudioProvisional(seed: StudioSeed | null | undefined, scope?: StudioScope): Promise<Record<string, IndexProvisional>> {
  const ids = (seed?.active?.length ? seed.active : seedActiveFor(scope)).filter((id) => id.startsWith("idx:"));
  const out: Record<string, IndexProvisional> = {};
  await Promise.all(
    ids.map(async (id) => {
      const [, entity, ...rest] = id.split(":");
      // The catalog reads every index line from 2000-01-01; same axis here.
      const p = await readIndexProvisional(entity as IndexEntity, rest.join(":"), { from: "2000-01-01" }).catch(() => null);
      if (p) out[id] = p;
    }),
  );
  return out;
}
