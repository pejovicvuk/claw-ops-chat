import { extractSession, unauthorized } from "@/lib/auth-server";
import { fetchWithHops } from "@/lib/proxy/fetch-with-hops";
import { SsrfError } from "@/lib/proxy/ssrf-guard";
import { parseOpenGraph, type UnfurlData } from "@/lib/proxy/unfurl-parser";
import { readUnfurl, writeUnfurl } from "@/lib/proxy/unfurl-cache";

/**
 * Fetches OpenGraph metadata for a URL, caches it, and rewrites any
 * absolute image URLs to point at /api/proxy/image so the browser
 * always stays same-origin (respecting the strict CSP).
 *
 * GET /api/proxy/unfurl?url=<encoded>
 */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";
const UNFURL_MAX_HTML_BYTES = 2 * 1024 * 1024;

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  if (!target) {
    return Response.json({ error: "url parameter required" }, { status: 400 });
  }

  // Normalise for cache key — trim whitespace, drop trailing fragments.
  let normalised: string;
  try {
    const parsed = new URL(target);
    parsed.hash = "";
    normalised = parsed.toString();
  } catch {
    return Response.json({ error: "Invalid url" }, { status: 400 });
  }

  // Cache hit.
  const cached = await readUnfurl(normalised);
  if (cached) {
    return Response.json(rewriteImageUrls(cached), {
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  }

  // Fetch with redirect-safe SSRF guard.
  let result;
  try {
    result = await fetchWithHops(normalised, {
      timeoutMs: 5000,
      maxBytes: UNFURL_MAX_HTML_BYTES,
      maxRedirects: 3,
      headers: { Accept: "text/html,application/xhtml+xml" },
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
    return Response.json(
      { error: `Upstream returned ${result.status}`, status: result.status },
      { status: 502 },
    );
  }

  const contentType = result.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    // Non-HTML — return a minimal card using the URL hostname.
    const minimal: UnfurlData = {
      url: result.finalUrl.toString(),
      title: result.finalUrl.hostname,
      description: null,
      imageUrl: null,
      siteName: result.finalUrl.hostname,
      favicon: `https://${result.finalUrl.hostname}/favicon.ico`,
    };
    await writeUnfurl(normalised, minimal);
    return Response.json(rewriteImageUrls(minimal), {
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  }

  const html = new TextDecoder("utf-8", { fatal: false }).decode(result.body);
  const data = parseOpenGraph(html, result.finalUrl);
  await writeUnfurl(normalised, data);
  return Response.json(rewriteImageUrls(data), {
    headers: { "Cache-Control": "private, max-age=3600" },
  });
}

/** Point imageUrl + favicon at the same-origin image proxy. */
function rewriteImageUrls(data: UnfurlData): UnfurlData {
  return {
    ...data,
    imageUrl: data.imageUrl
      ? `${BASE}/api/proxy/image?url=${encodeURIComponent(data.imageUrl)}`
      : null,
    favicon: data.favicon
      ? `${BASE}/api/proxy/image?url=${encodeURIComponent(data.favicon)}`
      : null,
  };
}
