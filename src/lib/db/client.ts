/**
 * Supabase client (service-role) — the single entry point for all server-side
 * DB access: Server Components, route handlers, and the warmer scripts (tsx).
 *
 * Uses the SERVICE ROLE key, so it BYPASSES RLS. Do NOT import this into a
 * Client Component.
 *
 * We intentionally avoid the `server-only` guard here: the warmer scripts run
 * under tsx (plain Node), where importing `server-only` throws. Protection
 * instead comes from reading SUPABASE_SERVICE_ROLE_KEY — a non-public env var
 * that Next never bundles into the browser.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/** Lazily-constructed singleton. Throws a clear error if env is missing. */
export function db(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env missing: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local / Vercel env.",
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
