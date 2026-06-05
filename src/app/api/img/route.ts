import type { NextRequest } from "next/server";

/**
 * Image proxy.
 *
 * Some upstream CDNs (looking at you `images.beezie.com`) serve images with
 * a `Cross-Origin-Resource-Policy: same-origin` header. Browsers then refuse
 * to render those images when loaded cross-origin — every Beezie card in our
 * UI shows broken (`ERR_BLOCKED_BY_ORB` in DevTools).
 *
 * Fix: fetch the image from our server (no CORS in play) and re-serve it
 * with permissive headers + long cache TTLs. Use:
 *
 *   <img src={`/api/img?url=${encodeURIComponent(remote)}`} />
 *
 * Or via the `proxyImg()` helper in `@/lib/img`.
 *
 * Allowlist is intentional — never let arbitrary URLs flow through, that
 * would be an open redirector + bandwidth abuse vector.
 */

const ALLOWED_HOSTS = new Set<string>([
  "images.beezie.com",
  "api.beezie.com",
  "cdn.collectorcrypt.com",
  "shdw-drive.genesysgo.net",          // Solana Shadow Drive (CC fallback)
  "arweave.net",                        // common NFT storage (apex)
  "ipfs.io",
  "gateway.ipfs.io",
  "cloudflare-ipfs.com",
  "nftstorage.link",
  "i.seadn.io",                         // OpenSea CDN
  "metadata.degods.com",
  "img.rarible.com",
  "raw.seadn.io",
]);

/**
 * Hosts allowed by domain suffix (covers unbounded subdomains).
 * Arweave's apex redirects to a per-resource sandbox subdomain like
 * `<hash>.arweave.net`, so we must allow any `*.arweave.net`.
 */
const ALLOWED_SUFFIXES = [".arweave.net"];

function hostAllowed(hostname: string): boolean {
  if (ALLOWED_HOSTS.has(hostname)) return true;
  return ALLOWED_SUFFIXES.some((sfx) => hostname.endsWith(sfx));
}

const ONE_DAY_S = 60 * 60 * 24;
const ONE_YEAR_S = 60 * 60 * 24 * 365;

export async function GET(req: NextRequest): Promise<Response> {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) return badRequest("Missing url parameter");

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return badRequest("Invalid url");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return badRequest("Only http(s) URLs allowed");
  }
  if (!hostAllowed(parsed.hostname)) {
    return new Response(`Host not allowed: ${parsed.hostname}`, { status: 403 });
  }

  // Cap the upstream fetch so a slow / dead gateway (arweave often hangs on
  // missing assets) returns an error fast instead of holding the connection.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 12_000);

  try {
    const upstream = await fetch(parsed.toString(), {
      // Don't let Next buffer the (potentially multi-MB) binary into its Data
      // Cache — that defeats streaming and can hang on large NFT art. We set
      // our own browser/CDN cache-control headers on the Response below.
      cache: "no-store",
      signal: abort.signal,
      headers: {
        // Some CDNs refuse default UA; impersonate a normal browser request.
        "user-agent":
          "Mozilla/5.0 (compatible; tcg.market-img-proxy/1.0; +https://tcg.market)",
        accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
      },
    });
    clearTimeout(timer);

    if (!upstream.ok || !upstream.body) {
      return new Response(`Upstream ${upstream.status}`, {
        status: upstream.ok ? 502 : upstream.status,
        headers: { "cache-control": "public, max-age=60" }, // don't loop on errors
      });
    }

    const upstreamType = upstream.headers.get("content-type");
    const notImage = (status = 415) =>
      new Response("Not an image", {
        status,
        headers: { "cache-control": "public, max-age=300" },
      });

    // Reject obvious HTML error pages served with a 200 (arweave does this for
    // dead assets) so the <img> onError fires → UI placeholder shows.
    if (upstreamType && (upstreamType.startsWith("text/") || upstreamType.includes("html"))) {
      return notImage();
    }

    // Peek the first chunk to sniff the real type WITHOUT buffering the whole
    // file (NFT art on arweave can be 5–10MB). Then stream the rest through.
    const reader = upstream.body.getReader();
    const first = await reader.read();
    const head = first.value ?? new Uint8Array(0);

    // Arweave/IPFS often serve images as `application/octet-stream`. Sniff
    // magic bytes to recover the real image type; reject if it's not an image.
    const isGenericBinary =
      !upstreamType ||
      upstreamType.startsWith("application/octet-stream") ||
      upstreamType.startsWith("binary/");
    let contentType: string;
    if (isGenericBinary) {
      const sniffed = sniffImageType(head.buffer as ArrayBuffer);
      if (!sniffed) {
        await reader.cancel().catch(() => {});
        return notImage();
      }
      contentType = sniffed;
    } else {
      contentType = upstreamType;
    }

    // Re-emit the peeked first chunk, then pipe the remaining stream.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (head.byteLength > 0) controller.enqueue(head);
        if (first.done) {
          controller.close();
          return;
        }
      },
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": contentType,
        // Browser + CDN cache aggressively; image bytes are immutable per URL.
        "cache-control": `public, max-age=${ONE_DAY_S}, s-maxage=${ONE_YEAR_S}, immutable`,
        // Permissive resource policy so the image can be embedded anywhere.
        "cross-origin-resource-policy": "cross-origin",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = (err as Error).name === "AbortError";
    return new Response(
      aborted ? "Upstream timed out" : `Proxy fetch failed: ${(err as Error).message}`,
      {
        status: aborted ? 504 : 502,
        headers: { "cache-control": "public, max-age=60" },
      },
    );
  }
}

function badRequest(message: string): Response {
  return new Response(message, { status: 400 });
}

/**
 * Detect image type from the leading magic bytes. Covers the formats NFT
 * art ships as. Returns null when the bytes don't match a known image —
 * the caller then falls back to extension-based guessing.
 */
function sniffImageType(buf: ArrayBuffer): string | null {
  const b = new Uint8Array(buf.slice(0, 16));
  // PNG: 89 50 4E 47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  // GIF: 47 49 46
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  // RIFF....WEBP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  // AVIF / HEIF: bytes 4-11 == "ftyp" + brand "avif"/"heic"
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand.startsWith("hei")) return "image/heic";
  }
  // SVG (text): starts with "<svg" or "<?xml"
  if (b[0] === 0x3c && (b[1] === 0x73 || b[1] === 0x3f)) return "image/svg+xml";
  return null;
}
