/**
 * Generic snapshot-blob store in the `snapshots` table.
 *
 * Used by the cache modules that read/write a whole snapshot object (holders,
 * marketcap, listings, cc-sales, courtyard-primary, primary-revenue, per-platform
 * history). Each key holds one JSON payload + a generated_at. This is the
 * Phase-2 migration off local disk — see MIGRATION_PLAN.md §2.
 */
import { db } from "./client";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * LOCAL VERIFICATION ONLY. When SNAPSHOT_LOCAL_DIR is set, a snapshot key that has
 * a `<dir>/<key>.json` file is served from disk instead of Postgres. This exists so
 * a rebuilt blob can be gated (check-invariants), rendered (the dev server) and
 * screenshotted WITHOUT running a warmer against the production database — the
 * warmer's `--out` flag writes the file this reads. Never set in Vercel.
 */
function readLocalOverride<T>(key: string): T | null | undefined {
  const dir = process.env.SNAPSHOT_LOCAL_DIR;
  if (!dir) return undefined;
  const file = join(dir, `${key}.json`);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (e) {
    console.warn(`[snapshots] local override "${key}" unreadable: ${(e as Error).message}`);
    return undefined;
  }
}

export async function readSnapshot<T>(key: string): Promise<T | null> {
  const local = readLocalOverride<T>(key);
  if (local !== undefined) return local;
  // Never throw — a read must degrade to null, not crash the caller. This also makes
  // ISR build-time prerendering safe: if the DB/env is unavailable at build, the page
  // renders empty and fills in on the first runtime revalidation (rather than failing
  // the build). Covers both query errors AND a db() env-missing throw.
  try {
    const { data, error } = await db()
      .from("snapshots")
      .select("payload")
      .eq("key", key)
      .maybeSingle();
    if (error) {
      console.warn(`[snapshots] read "${key}" failed: ${error.message}`);
      return null;
    }
    return (data?.payload as T) ?? null;
  } catch (e) {
    console.warn(`[snapshots] read "${key}" threw: ${(e as Error).message}`);
    return null;
  }
}

export async function writeSnapshot(
  key: string,
  payload: unknown,
  generatedAt?: string,
): Promise<void> {
  const { error } = await db()
    .from("snapshots")
    .upsert({ key, payload, generated_at: generatedAt ?? new Date().toISOString() });
  if (error) throw new Error(`[snapshots] write "${key}" failed: ${error.message}`);
}
