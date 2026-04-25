/**
 * Detect file paths in free-form text so ToolResultBlock / markdown
 * output can render them as clickable FilePathPills.
 *
 * Two flavours are emitted:
 *   - `path`      anchored by `/`, `~/`, or `./` — resolves directly via
 *                 safePath() server-side. Always rendered as a pill.
 *   - `candidate` bare basename (`report.pdf`) or relative-with-slash
 *                 (`notes/draft.md`) without an anchor. The renderer
 *                 must consult the workspace index to resolve it; if it
 *                 doesn't uniquely match a real file, the candidate
 *                 falls back to plain text. Bare names are higher
 *                 false-positive risk so a small denylist suppresses
 *                 known prose collisions (e.g. "next.js framework").
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

// Combined matcher: anchored OR unanchored.
//   Anchored body:    starts with `/`, `~/`, or `./`
//   Unanchored body:  word-anchored token, may contain `/` (relative path)
// Leading boundary uses a lookbehind (`^`, whitespace, or open punctuation)
// instead of `\b` so prose like `(see report.pdf)` matches and
// `abcreport.pdf` doesn't. The trailing `\b` after the extension still
// lets sentence-final punctuation (`.`, `,`, `!`) clip cleanly.
const PATH_RE = new RegExp(
  `(?<=^|[\\s(\\[{<"'\`])` +
    `(?:` +
    `(?:~\\/|\\.\\/|\\/)[\\w.@/~-]*\\w` +
    `|` +
    `\\w(?:[\\w./@~-]*\\w)?` +
    `)` +
    `\\.${EXT_RE}\\b`,
  "gi",
);

/**
 * Common library/framework names that look exactly like a `<word>.js`
 * filename but are nearly always prose, not file references. Filtered
 * post-match so the regex stays simple. The workspace-index resolver
 * provides a second layer of defense: even if a denylist entry slips
 * through, an ambiguous / unresolved candidate already renders as plain
 * text.
 */
const PROSE_DENYLIST = new Set([
  "next.js",
  "node.js",
  "react.js",
  "vue.js",
  "nuxt.js",
  "express.js",
  "d3.js",
]);

function isAnchoredPath(p: string): boolean {
  return p.startsWith("/") || p.startsWith("~/") || p.startsWith("./");
}

export interface TextSegment {
  kind: "text";
  text: string;
}

export interface PathSegment {
  kind: "path";
  path: string;
}

export interface CandidateSegment {
  kind: "candidate";
  candidate: string;
}

export type Segment = TextSegment | PathSegment | CandidateSegment;

export function detectFilePaths(text: string): Segment[] {
  if (!text) return [];
  const out: Segment[] = [];
  let cursor = 0;
  PATH_RE.lastIndex = 0;
  for (const match of text.matchAll(PATH_RE)) {
    if (match.index === undefined) continue;
    // Trim trailing punctuation that clipped into the match (e.g. "foo.ts.").
    let raw = match[0];
    while (/[.,;:!?)]$/.test(raw) && raw.length > 2) {
      raw = raw.slice(0, -1);
    }
    if (PROSE_DENYLIST.has(raw.toLowerCase())) continue;
    const start = match.index;
    const end = start + raw.length;
    if (start > cursor) {
      out.push({ kind: "text", text: text.slice(cursor, start) });
    }
    if (isAnchoredPath(raw)) {
      out.push({ kind: "path", path: raw });
    } else {
      out.push({ kind: "candidate", candidate: raw });
    }
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
 * Anchored-path matcher for lone-line detection. Mirrors the anchored
 * branch of `PATH_RE`.
 */
const LONE_PATH_RE = new RegExp(`^(?:~\\/|\\.\\/|\\/)[\\w.@/~-]*\\w\\.${EXT_RE}$`, "i");

/**
 * Unanchored counterpart — a bare basename or relative-with-slash that
 * needs workspace-index resolution before it can be rendered. The
 * leading lookbehind isn't needed here because the line is already
 * trimmed and bullet-stripped by the caller; we just anchor to `^…$`.
 */
const LONE_CANDIDATE_RE = new RegExp(`^\\w(?:[\\w./@~-]*\\w)?\\.${EXT_RE}$`, "i");

export type LonePathLine = { kind: "path"; value: string } | { kind: "candidate"; value: string };

/**
 * If `line` is JUST a file reference (optionally prefixed with a bullet
 * marker `- ` / `* ` / `• `), return { kind, value }. Used by the
 * markdown renderer to decide whether a paragraph/list-item segment
 * should become a full attachment card vs a compact inline pill.
 *
 * Returns null for normal prose. Also returns null for denylisted
 * tokens so prose lines like a lone `next.js` aren't promoted to a card.
 */
export function isLonePathLine(line: string): LonePathLine | null {
  if (!line) return null;
  // Strip leading bullet markers + whitespace.
  const stripped = line.replace(/^[\s]*[-*•]\s+/, "").trim();
  if (!stripped) return null;
  // Clip trailing punctuation the same way detectFilePaths does.
  let candidate = stripped;
  while (/[.,;:!?)]$/.test(candidate) && candidate.length > 2) {
    candidate = candidate.slice(0, -1);
  }
  if (LONE_PATH_RE.test(candidate)) return { kind: "path", value: candidate };
  if (PROSE_DENYLIST.has(candidate.toLowerCase())) return null;
  if (LONE_CANDIDATE_RE.test(candidate)) return { kind: "candidate", value: candidate };
  return null;
}
