"use client";

import { useEffect, useRef, useState } from "react";
import { FiCheck, FiCopy } from "react-icons/fi";

/**
 * Lazy-loaded shiki syntax highlighter. Falls back to a plain <pre>
 * block while shiki initialises, so first paint is instant.
 *
 * Shared singleton highlighter instance (module-scoped Promise) so
 * every SyntaxCode on the page reuses the same wasm + themes.
 */

const SHIKI_LANGS = [
  "bash",
  "css",
  "diff",
  "go",
  "html",
  "java",
  "javascript",
  "json",
  "jsx",
  "markdown",
  "python",
  "rust",
  "sql",
  "tsx",
  "typescript",
  "yaml",
] as const;

type HighlighterInstance = {
  codeToHtml: (
    code: string,
    opts: { lang: string; theme: string; themes?: Record<string, string> },
  ) => string;
};

let highlighterPromise: Promise<HighlighterInstance | null> | null = null;

function getHighlighter(): Promise<HighlighterInstance | null> {
  if (highlighterPromise) return highlighterPromise;
  highlighterPromise = (async () => {
    try {
      const shiki = await import("shiki");
      return (await shiki.createHighlighter({
        themes: ["github-dark-default", "github-light-default"],
        langs: [...SHIKI_LANGS],
      })) as HighlighterInstance;
    } catch {
      return null;
    }
  })();
  return highlighterPromise;
}

function normaliseLang(lang: string): string {
  const l = lang.toLowerCase();
  if (l === "ts") return "typescript";
  if (l === "js") return "javascript";
  if (l === "py") return "python";
  if (l === "rs") return "rust";
  if (l === "sh" || l === "zsh") return "bash";
  if (l === "yml") return "yaml";
  if (l === "md" || l === "mdx") return "markdown";
  if ((SHIKI_LANGS as readonly string[]).includes(l)) return l;
  return "";
}

interface SyntaxCodeProps {
  language: string;
  code: string;
}

export function SyntaxCode({ language, code }: SyntaxCodeProps) {
  const lang = normaliseLang(language);
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!lang) return;
    let cancelled = false;
    getHighlighter().then((h) => {
      if (cancelled || !h) return;
      try {
        const theme =
          typeof document !== "undefined" && document.documentElement.classList.contains("dark")
            ? "github-dark-default"
            : "github-light-default";
        const rendered = h.codeToHtml(code, { lang, theme });
        setHtml(rendered);
      } catch {
        /* unsupported lang — keep plain fallback */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [lang, code]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="group relative my-2 overflow-hidden rounded-md border border-canvas-border bg-canvas-bg">
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-canvas-surface/90 text-canvas-muted opacity-0 transition-opacity hover:bg-canvas-surface-hover hover:text-canvas-fg focus:opacity-100 group-hover:opacity-100 sm:opacity-100"
      >
        {copied ? <FiCheck size={12} /> : <FiCopy size={12} />}
      </button>
      {html ? (
        <div
          ref={containerRef}
          className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed [&_pre]:!bg-transparent [&_pre]:!p-0"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-canvas-fg">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
