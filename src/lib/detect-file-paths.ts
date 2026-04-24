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
  "(?:" +
  // images
  "png|jpe?g|gif|webp|svg|avif|bmp|ico|heic|heif|" +
  // documents / formats
  "pdf|pptx?|docx?|xlsx?|odt|ods|odp|rtf|" +
  // archives
  "zip|tar|gz|tgz|7z|rar|bz2|xz|" +
  // media
  "mp4|mov|webm|mkv|m4v|mp3|wav|ogg|m4a|flac|aac|" +
  // text / code / config
  "md|mdx|txt|log|json|yaml|yml|csv|html?|xml|ts|tsx|js|jsx|mjs|cjs|py|rs|go|sh|bash|zsh|rb|java|kt|swift|c|cpp|h|hpp|cs|sql|toml|env|conf|ini" +
  ")";

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

/**
 * Regex matching a single path with the same rules as detectFilePaths —
 * requires a path anchor (/ or ~/ or ./) and a recognised extension.
 * Anchored (^…$) so callers use it against already-trimmed single lines.
 */
const LONE_PATH_RE = new RegExp(`^(?:~\\/|\\.\\/|\\/)[\\w.@/~-]*\\w\\.${EXT_RE}$`, "i");

/**
 * If `line` is JUST a file path (optionally prefixed with a bullet
 * marker `- ` / `* ` / `• `), return the path. Used by the markdown
 * renderer to decide whether a paragraph/list-item segment should
 * become a full attachment card vs a compact inline pill.
 */
export function isLonePathLine(line: string): string | null {
  if (!line) return null;
  // Strip leading bullet markers + whitespace.
  const stripped = line.replace(/^[\s]*[-*•]\s+/, "").trim();
  if (!stripped) return null;
  // Clip trailing punctuation the same way detectFilePaths does.
  let candidate = stripped;
  while (/[.,;:!?)]$/.test(candidate) && candidate.length > 2) {
    candidate = candidate.slice(0, -1);
  }
  return LONE_PATH_RE.test(candidate) ? candidate : null;
}
