const BASE_URL = "https://api.rarible.org/v0.1";

class RaribleError extends Error {
  constructor(
    public status: number,
    public body: string,
    public path: string,
  ) {
    super(`Rarible ${status} on ${path}: ${body.slice(0, 200)}`);
  }
}

function apiKey(): string {
  const k = process.env.RARIBLE_API_KEY;
  if (!k) throw new Error("RARIBLE_API_KEY is not set");
  return k;
}

/**
 * Wrapped fetch with a per-request TIMEOUT + retry on transient network errors
 * (timeout, ECONNRESET, socket hangs, 5xx, 429). Up to 5 attempts with
 * exponential backoff. The timeout is the critical part: without it, a Rarible
 * endpoint that holds the connection open (e.g. /ownerships/byCollection for
 * some collections) hangs the caller forever — which is exactly how the holders
 * warmer rotted silently. Now a stuck request aborts and either retries or
 * fails loudly so runWarmer can record it.
 */
const REQUEST_TIMEOUT_MS = 30_000;

async function fetchWithRetry(url: string, init: RequestInit, path: string): Promise<Response> {
  let attempt = 0;
  const maxAttempts = 5;
  while (true) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt >= maxAttempts - 1) {
          throw new RaribleError(res.status, await res.text(), path);
        }
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        attempt += 1;
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      const isTimeout = (err as Error).name === "AbortError";
      const isTransient =
        isTimeout ||
        err instanceof TypeError ||
        (err as { code?: string }).code === "ECONNRESET" ||
        (err as { code?: string }).code === "ETIMEDOUT" ||
        /fetch failed|ECONNRESET|socket hang up|ETIMEDOUT|terminated/i.test(
          (err as Error).message ?? "",
        );
      if (!isTransient || attempt >= maxAttempts - 1) {
        throw isTimeout
          ? new RaribleError(408, `request exceeded ${REQUEST_TIMEOUT_MS}ms`, path)
          : err;
      }
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      attempt += 1;
    }
  }
}

export async function raribleGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetchWithRetry(
    url.toString(),
    { headers: { "x-api-key": apiKey() }, cache: "no-store" },
    path,
  );
  if (!res.ok) throw new RaribleError(res.status, await res.text(), path);
  return (await res.json()) as T;
}

export async function raribleGetBatch<T>(
  path: string,
  params: Record<string, string | number | string[] | undefined>,
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, String(item));
    } else {
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetchWithRetry(
    url.toString(),
    { headers: { "x-api-key": apiKey() }, cache: "no-store" },
    path,
  );
  if (!res.ok) throw new RaribleError(res.status, await res.text(), path);
  return (await res.json()) as T;
}

export { RaribleError };
