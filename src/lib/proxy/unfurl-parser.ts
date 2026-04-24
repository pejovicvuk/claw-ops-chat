/**
 * Minimal OpenGraph / HTML metadata parser. Returns the fields we need
 * for a compact unfurl card — avoids pulling cheerio/jsdom just to read
 * a dozen meta tags.
 *
 * We scan only the <head> slice of the document (up to the first
 * </head> or 512 KB, whichever comes first) to keep parsing fast even
 * on huge pages.
 */

export interface UnfurlData {
  url: string;
  title: string | null;
  description: string | null;
  /** Absolute URL of the OG image, or null if missing. */
  imageUrl: string | null;
  siteName: string | null;
  /** Absolute URL to a favicon, or null if missing. */
  favicon: string | null;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)));
}

function extractAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(tag);
  if (!m) return null;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
}

function findMeta(head: string, property: string, attrName: "property" | "name"): string | null {
  const re = new RegExp(`<meta\\s+[^>]*?\\b${attrName}\\s*=\\s*["']${property}["'][^>]*?>`, "gi");
  for (const match of head.matchAll(re)) {
    const content = extractAttr(match[0], "content");
    if (content && content.trim().length > 0) return content.trim();
  }
  return null;
}

function findTitleTag(head: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  if (!m) return null;
  return decodeEntities(m[1].trim()) || null;
}

function findFavicon(head: string, base: URL): string | null {
  // Prefer apple-touch-icon (usually larger and already square), then
  // rel="icon" or rel="shortcut icon". Fall back to /favicon.ico.
  const relPatterns = [
    /<link\s+[^>]*?\brel\s*=\s*["']apple-touch-icon["'][^>]*?>/i,
    /<link\s+[^>]*?\brel\s*=\s*["'][^"']*\bicon[^"']*["'][^>]*?>/i,
  ];
  for (const re of relPatterns) {
    const match = re.exec(head);
    if (!match) continue;
    const href = extractAttr(match[0], "href");
    if (href) {
      try {
        return new URL(href, base).toString();
      } catch {
        /* ignore */
      }
    }
  }
  try {
    return new URL("/favicon.ico", base).toString();
  } catch {
    return null;
  }
}

function resolveUrl(value: string | null, base: URL): string | null {
  if (!value) return null;
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

/**
 * Parse HTML (as a string) and extract unfurl fields. `baseUrl` is the
 * final URL of the response (after redirects) — used to resolve
 * relative <img> / <link> hrefs.
 */
export function parseOpenGraph(html: string, baseUrl: URL): UnfurlData {
  // Clip to <head> to skip body parsing — an unfurl only needs head tags.
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 512 * 1024);

  const title =
    findMeta(head, "og:title", "property") ??
    findMeta(head, "twitter:title", "name") ??
    findTitleTag(head);

  const description =
    findMeta(head, "og:description", "property") ??
    findMeta(head, "twitter:description", "name") ??
    findMeta(head, "description", "name");

  const siteName = findMeta(head, "og:site_name", "property") ?? baseUrl.hostname;

  const ogImage =
    findMeta(head, "og:image", "property") ??
    findMeta(head, "twitter:image", "name") ??
    findMeta(head, "twitter:image:src", "name");
  const imageUrl = resolveUrl(ogImage, baseUrl);

  const favicon = findFavicon(head, baseUrl);

  return {
    url: baseUrl.toString(),
    title: title?.trim() || null,
    description: description?.trim().slice(0, 300) || null,
    imageUrl,
    siteName: siteName?.trim() || null,
    favicon,
  };
}
