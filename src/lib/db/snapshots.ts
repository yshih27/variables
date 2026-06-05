/**
 * Generic snapshot-blob store in the `snapshots` table.
 *
 * Used by the cache modules that read/write a whole snapshot object (holders,
 * marketcap, listings, cc-sales, courtyard-primary, primary-revenue, per-platform
 * history). Each key holds one JSON payload + a generated_at. This is the
 * Phase-2 migration off local disk — see MIGRATION_PLAN.md §2.
 */
import { db } from "./client";

export async function readSnapshot<T>(key: string): Promise<T | null> {
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
