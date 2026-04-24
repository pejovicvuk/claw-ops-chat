import { extractSession, unauthorized } from "@/lib/auth-server";
import { fetchWithHops } from "@/lib/proxy/fetch-with-hops";
import { SsrfError } from "@/lib/proxy/ssrf-guard";
import { readImage, writeImage } from "@/lib/proxy/image-cache";

/**
 * Fetches + caches external images, serving them same-origin so the
 * strict CSP (`img-src 'self' data: blob:`) allows <img src=>.
 *
 * GET /api/proxy/image?url=<encoded>
 */

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = /^image\//i;

/**
 * Copy into a fresh ArrayBuffer so the resulting typed array is
 * Uint8Array<ArrayBuffer> (not Uint8Array<ArrayBufferLike>), which is
 * what Response's BodyInit expects under strict TS.
 */
function toBody(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const ab = new ArrayBuffer(bytes.byteLength);
  const view = new Uint8Array(ab);
  view.set(bytes);
  return view;
}

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  if (!target) {
    return Response.json({ error: "url parameter required" }, { status: 400 });
  }

  let normalised: string;
  try {
    const parsed = new URL(target);
    parsed.hash = "";
    normalised = parsed.toString();
  } catch {
    return Response.json({ error: "Invalid url" }, { status: 400 });
  }

  // Cache hit → stream cached bytes with original Content-Type.
  const cached = await readImage(normalised);
  if (cached) {
    return new Response(toBody(cached.bytes), {
      status: 200,
      headers: {
        "Content-Type": cached.contentType,
        "Cache-Control": "private, max-age=604800",
        "X-Content-Type-Options": "nosniff",
        "X-Cache": "HIT",
      },
    });
  }

  let result;
  try {
    result = await fetchWithHops(normalised, {
      timeoutMs: 5000,
      maxBytes: IMAGE_MAX_BYTES,
      maxRedirects: 3,
      headers: { Accept: "image/*" },
    });
  } catch (err) {
    if (err instanceof SsrfError) {
      return Response.json({ error: "SSRF", detail: err.message }, { status: 400 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Fetch failed" },
      { status: 502 },
    );
  }

  if (result.status < 200 || result.status >= 400) {
    return Response.json({ error: `Upstream returned ${result.status}` }, { status: 502 });
  }

  const upstreamType = result.headers.get("content-type") ?? "";
  if (!ALLOWED_TYPES.test(upstreamType)) {
    return Response.json({ error: `Not an image (${upstreamType || "unknown"})` }, { status: 415 });
  }

  // Strip any charset parameter from the stored Content-Type.
  const cleanType = upstreamType.split(";")[0].trim();
  await writeImage(normalised, result.body, cleanType);

  return new Response(toBody(result.body), {
    status: 200,
    headers: {
      "Content-Type": cleanType,
      "Cache-Control": "private, max-age=604800",
      "X-Content-Type-Options": "nosniff",
      "X-Cache": "MISS",
    },
  });
}
