import { mimeFor } from "../mime";

export type PreviewKind =
  | "markdown"
  | "text"
  | "code"
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "binary";

export interface PreviewChoice {
  kind: PreviewKind;
  /** Language hint for `code`, suitable for `<SyntaxCode language=…>`. */
  language?: string;
}

const MARKDOWN_EXTS = new Set(["md", "mdx", "markdown"]);
const PLAIN_TEXT_EXTS = new Set([
  "txt",
  "log",
  "csv",
  "tsv",
  "env",
  "conf",
  "ini",
  "gitignore",
  "gitattributes",
  "editorconfig",
  "npmrc",
  "nvmrc",
  "lock",
]);

/**
 * Map of file extension → shiki language id used by `<SyntaxCode>`. Only
 * languages that the bundled highlighter supports (or that `normaliseLang`
 * rewrites into a supported one) are listed here.
 */
const CODE_LANGS: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  html: "html",
  htm: "html",
  css: "css",
  diff: "diff",
  patch: "diff",
};

function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? "";
  // Dotfiles where the "name" itself is the type label (.gitignore, .env)
  // are treated as their stripped name (gitignore → plain text via the set).
  if (base.startsWith(".") && !base.slice(1).includes(".")) return base.slice(1).toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Choose the right preview surface for a file. Pure function, no IO.
 * Used by the file editor panel to decide between the readable view
 * (markdown / syntax-highlighted code / plain text / inline media) and
 * the CodeMirror edit surface.
 */
export function pickRenderer(path: string): PreviewChoice {
  const ext = extensionOf(path);
  if (MARKDOWN_EXTS.has(ext)) return { kind: "markdown" };
  if (CODE_LANGS[ext]) return { kind: "code", language: CODE_LANGS[ext] };
  if (PLAIN_TEXT_EXTS.has(ext)) return { kind: "text" };

  const mime = mimeFor(path).split(";")[0].trim();
  if (mime.startsWith("image/")) return { kind: "image" };
  if (mime === "application/pdf") return { kind: "pdf" };
  if (mime.startsWith("video/")) return { kind: "video" };
  if (mime.startsWith("audio/")) return { kind: "audio" };
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml") {
    return { kind: "text" };
  }

  return { kind: "binary" };
}

/** Which preview kinds are editable in CodeMirror. */
export function isEditableKind(kind: PreviewKind): boolean {
  return kind === "markdown" || kind === "text" || kind === "code";
}
