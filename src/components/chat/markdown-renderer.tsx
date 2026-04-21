"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";

// Module-level: stable reference required so react-markdown keeps its per-component cache.
const markdownComponents = {
  p: ({ children }: { children?: ReactNode }) => (
    <p className="my-1 text-[14px] leading-relaxed text-canvas-fg">{children}</p>
  ),
  code: ({ className, children }: { className?: string; children?: ReactNode }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code className="block overflow-x-auto rounded bg-canvas-bg p-3 font-mono text-[12px] leading-relaxed text-canvas-fg">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-canvas-surface-hover px-1.5 py-0.5 font-mono text-[12px] text-canvas-fg">
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-canvas-bg border border-canvas-border">
      {children}
    </pre>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-bold text-canvas-fg">{children}</strong>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="my-1.5 ml-4 list-disc text-[14px] text-canvas-fg">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="my-1.5 ml-4 list-decimal text-[14px] text-canvas-fg">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => <li className="my-0.5">{children}</li>,
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a href={href} className="text-accent underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className="my-2 overflow-x-auto rounded-md border border-canvas-border">
      <table className="w-full text-[12px] text-canvas-fg">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className="border-b border-canvas-border bg-canvas-surface-hover">{children}</thead>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-400">{children}</th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="border-t border-canvas-border px-3 py-1.5">{children}</td>
  ),
};

export default function MarkdownRenderer({ text }: { text: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {text}
    </Markdown>
  );
}
