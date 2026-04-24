import { assertPublicUrl, SsrfError } from "./ssrf-guard";

/**
 * Fetch with manual redirect following so the SSRF guard runs on every
 * hop. Using the built-in `redirect: "follow"` skips this check for
 * intermediate URLs, which would allow a public→private redirect.
 *
 * Also caps body size — the caller passes `maxBytes` and we abort
 * streaming if exceeded. Used by both the unfurl and image proxies.
 */

export interface FetchWithHopsOptions {
  /** Max redirect hops. Default 3. */
  maxRedirects?: number;
  /** Overall timeout in ms (applies per hop). Default 5000. */
  timeoutMs?: number;
  /** Max response body bytes. Default 5 MB. */
  maxBytes?: number;
  /** HTTP headers to forward (plus our UA). */
  headers?: Record<string, string>;
  /** Request method. Default "GET". */
  method?: string;
}

export interface FetchWithHopsResult {
  /** Final URL after following redirects. */
  finalUrl: URL;
  /** HTTP status code. */
  status: number;
  /** Response headers (keys lower-cased for convenience). */
  headers: Headers;
  /** Full response body, bounded by maxBytes. */
  body: Uint8Array;
}

const USER_AGENT = "claw-chat-preview-bot/1.0 (+https://github.com/anthropics/claude-code)";

export async function fetchWithHops(
  rawUrl: string,
  opts: FetchWithHopsOptions = {},
): Promise<FetchWithHopsResult> {
  const maxRedirects = opts.maxRedirects ?? 3;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;

  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = await assertPublicUrl(currentUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(parsed.toString(), {
        method: opts.method ?? "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "*/*",
          ...opts.headers,
        },
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof SsrfError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Fetch failed for ${parsed.toString()}: ${message}`);
    }
    clearTimeout(timer);

    // Handle redirects (301, 302, 303, 307, 308).
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        // No Location header on a 3xx — treat as done and return what we got.
        return toResult(res, parsed, maxBytes);
      }
      if (hop === maxRedirects) {
        throw new Error(`Too many redirects for ${rawUrl}`);
      }
      // Resolve relative redirects against the current URL.
      currentUrl = new URL(location, parsed).toString();
      continue;
    }

    return toResult(res, parsed, maxBytes);
  }
  throw new Error(`Too many redirects for ${rawUrl}`);
}

async function toResult(
  res: Response,
  parsed: URL,
  maxBytes: number,
): Promise<FetchWithHopsResult> {
  // Check Content-Length up front if present; bail early if over limit.
  const cl = res.headers.get("content-length");
  if (cl) {
    const n = Number.parseInt(cl, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      throw new Error(`Response too large: ${n} > ${maxBytes}`);
    }
  }
  // Stream with manual cap — the server might lie about Content-Length.
  if (!res.body) {
    return {
      finalUrl: parsed,
      status: res.status,
      headers: res.headers,
      body: new Uint8Array(0),
    };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      throw new Error(`Response too large: exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    body.set(c, off);
    off += c.byteLength;
  }
  return { finalUrl: parsed, status: res.status, headers: res.headers, body };
}
