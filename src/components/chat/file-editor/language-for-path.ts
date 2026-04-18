"use client";

import type { Extension } from "@codemirror/state";

/**
 * Lazy-load CodeMirror language support based on file extension.
 * Each language module is imported only when first needed; subsequent
 * loads hit the browser's module cache.
 */

type Loader = () => Promise<Extension>;

const LOADERS: Record<string, Loader> = {
  js: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  mjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  cjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  jsx: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  ts: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
  tsx: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ jsx: true, typescript: true }),
    ),
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  py: () => import("@codemirror/lang-python").then((m) => m.python()),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  htm: () => import("@codemirror/lang-html").then((m) => m.html()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  scss: () => import("@codemirror/lang-css").then((m) => m.css()),
  md: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  mdx: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  markdown: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
};

/** Return the filename's extension (without leading dot), lowercased. */
export function extensionFor(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Resolve the language extension for a path. Returns an empty array
 * (valid CodeMirror extension set) for unknown/binary files so the
 * editor still renders as plain text with line numbers + search.
 */
export async function resolveLanguageExtension(path: string): Promise<Extension> {
  const ext = extensionFor(path);
  const loader = LOADERS[ext];
  if (!loader) return [];
  try {
    return await loader();
  } catch {
    return [];
  }
}
