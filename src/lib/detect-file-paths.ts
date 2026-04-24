/**
 * Detect file paths in free-form text so ToolResultBlock / markdown
 * output can render them as clickable FilePathPills. Conservative on
 * purpose — over-matching a sentence like "see the new TypeScript"
 * would litter every message with pills.
 *
 * The regex requires:
 *   - at least one path separator (/ or ~/) OR a dot-extension anchor
 *   - a recognised extension from EXT_RE
 *   - bounded by whitespace, punctuation, or start/end
 *
 * Returns a segmented array of { text } / { path } chunks so the caller
 * can render text spans + interactive pills in source order.
 */

const EXT_RE =
  "(?:png|jpe?g|gif|webp|svg|avif|bmp|ico|pdf|md|mdx|txt|log|json|yaml|yml|csv|html?|xml|ts|tsx|js|jsx|py|rs|go|sh|bash|zsh|rb|java|kt|swift|c|cpp|h|hpp|cs|sql|toml|env|conf|ini)";

// Path chars: letters, digits, underscore, dash, dot, slash, tilde, @ (for npm scopes).
// Requires at least one `/`, `~/`, or `./` somewhere to distinguish file paths
// from plain words with dot-extensions (e.g. "next.js" shouldn't match).
const PATH_RE = new RegExp(`(?:~\\/|\\.\\/|\\/)[\\w.@/~-]*\\w\\.${EXT_RE}\\b`, "gi");

export interface TextSegment {
  kind: "text";
  text: string;
}

export interface PathSegment {
  kind: "path";
  path: string;
}

export type Segment = TextSegment | PathSegment;

export function detectFilePaths(text: string): Segment[] {
  if (!text) return [];
  const out: Segment[] = [];
  let cursor = 0;
  PATH_RE.lastIndex = 0;
  for (const match of text.matchAll(PATH_RE)) {
    if (match.index === undefined) continue;
    // Trim trailing punctuation that clipped into the match (e.g. "foo.ts.").
    let path = match[0];
    while (/[.,;:!?)]$/.test(path) && path.length > 2) {
      path = path.slice(0, -1);
    }
    const start = match.index;
    const end = start + path.length;
    if (start > cursor) {
      out.push({ kind: "text", text: text.slice(cursor, start) });
    }
    out.push({ kind: "path", path });
    cursor = end;
  }
  if (cursor < text.length) {
    out.push({ kind: "text", text: text.slice(cursor) });
  }
  return out;
}

/** Quick "does this look like an image path?" check used by ImagePreview routing. */
export function isLikelyLocalPath(src: string): boolean {
  if (!src) return false;
  if (/^(https?|data|blob):/i.test(src)) return false;
  return /^(~|\/|\.\/|\.\.\/)/.test(src) || /^[A-Za-z]:[\\/]/.test(src);
}
