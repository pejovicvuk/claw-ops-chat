"use client";

import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { detectFilePaths, isLonePathLine } from "@/lib/detect-file-paths";
import { FileCard, ResolvedFileCard } from "./previews/file-card";
import { FilePathPill, ResolvedPathPill } from "./previews/file-path-pill";
import { ImagePreview } from "./previews/image-preview";
import { LinkPreview } from "./previews/link-preview";
import { SyntaxCode } from "./previews/syntax-code";

/**
 * Walks text children, splitting strings on detectFilePaths segments and
 * replacing path matches with <FilePathPill>. Non-string children pass
 * through unchanged so formatting (bold, italic, code) survives.
 */
function transformTextChildren(children: ReactNode): ReactNode {
  const out: ReactNode[] = [];
  Children.forEach(children, (child, idx) => {
    if (typeof child !== "string") {
      out.push(child);
      return;
    }
    const segs = detectFilePaths(child);
    if (segs.length === 0 || segs.every((s) => s.kind === "text")) {
      out.push(child);
      return;
    }
    segs.forEach((seg, i) => {
      if (seg.kind === "path") {
        out.push(<FilePathPill key={`pill-${idx}-${i}-${seg.path}`} path={seg.path} />);
      } else if (seg.kind === "candidate") {
        out.push(
          <ResolvedPathPill key={`cand-${idx}-${i}-${seg.candidate}`} candidate={seg.candidate} />,
        );
      } else if (seg.text) {
        out.push(seg.text);
      }
    });
  });
  return out;
}

/**
 * Is this child a <br> element? remark-breaks turns `\n` inside a
 * paragraph into <br>, which we split segments on to find "lone path"
 * lines that should render as FileCards instead of inline text.
 */
function isBreak(child: ReactNode): boolean {
  if (!isValidElement(child)) return false;
  const el = child as ReactElement;
  return el.type === "br";
}

type Segment =
  | { kind: "card"; path: string; key: string }
  | { kind: "card-candidate"; candidate: string; key: string }
  | { kind: "text"; nodes: ReactNode[]; key: string };

/**
 * Given the children of a <p> or <li>, split on <br>, and for each
 * segment decide whether it's a lone-path-line (card) or normal text.
 */
function splitIntoSegments(children: ReactNode): Segment[] {
  const array = Children.toArray(children);
  const segments: Segment[] = [];
  let current: ReactNode[] = [];
  let idx = 0;
  const flush = () => {
    if (current.length === 0) return;
    // A segment is "lone path" only if it's exactly one string child
    // whose trimmed content matches isLonePathLine.
    if (current.length === 1 && typeof current[0] === "string") {
      const lone = isLonePathLine(current[0] as string);
      if (lone) {
        if (lone.kind === "path") {
          segments.push({ kind: "card", path: lone.value, key: `card-${idx}-${lone.value}` });
        } else {
          segments.push({
            kind: "card-candidate",
            candidate: lone.value,
            key: `card-cand-${idx}-${lone.value}`,
          });
        }
        current = [];
        idx += 1;
        return;
      }
    }
    segments.push({ kind: "text", nodes: current, key: `text-${idx}` });
    current = [];
    idx += 1;
  };

  for (const child of array) {
    if (isBreak(child)) {
      flush();
      continue;
    }
    current.push(child);
  }
  flush();
  return segments;
}

/**
 * Render a block (`p` or `li`) that may contain a mix of lone file
 * paths (→ FileCard) and normal text (→ inline FilePathPill). When no
 * cards are present we emit the semantic tag; when cards are present
 * we degrade to a `<div>` since block cards can't nest inside <p>.
 */
function renderBlockWithFileCards(children: ReactNode, tag: "p" | "li"): ReactElement {
  const segments = splitIntoSegments(children);
  const hasCard = segments.some((s) => s.kind === "card" || s.kind === "card-candidate");

  if (!hasCard) {
    const transformed = transformTextChildren(children);
    if (tag === "p") {
      return <p className="my-1 text-[14px] leading-relaxed text-canvas-fg">{transformed}</p>;
    }
    return <li className="my-0.5">{transformed}</li>;
  }

  const body = (
    <div className="my-1 space-y-2 text-[14px] leading-relaxed text-canvas-fg">
      {segments.map((seg) => {
        if (seg.kind === "card") {
          return <FileCard key={seg.key} path={seg.path} />;
        }
        if (seg.kind === "card-candidate") {
          return <ResolvedFileCard key={seg.key} candidate={seg.candidate} />;
        }
        // Whitespace-only text segments between cards produce noise; skip.
        const isBlank =
          seg.nodes.length === 0 ||
          (seg.nodes.length === 1 &&
            typeof seg.nodes[0] === "string" &&
            (seg.nodes[0] as string).trim() === "");
        if (isBlank) return null;
        return <span key={seg.key}>{transformTextChildren(seg.nodes)}</span>;
      })}
    </div>
  );

  if (tag === "li") {
    return <li className="list-none my-0.5">{body}</li>;
  }
  return body;
}

// Module-level: stable reference required so react-markdown keeps its per-component cache.
const markdownComponents = {
  p: ({ children }: { children?: ReactNode }) => renderBlockWithFileCards(children, "p"),
  li: ({ children }: { children?: ReactNode }) => renderBlockWithFileCards(children, "li"),
  code: ({ className, children }: { className?: string; children?: ReactNode }) => {
    const match = /language-(\w+)/.exec(className ?? "");
    if (match) {
      const code = String(children).replace(/\n$/, "");
      return <SyntaxCode language={match[1]} code={code} />;
    }
    return (
      <code className="rounded bg-canvas-surface-hover px-1.5 py-0.5 font-mono text-[12px] text-canvas-fg">
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-bold text-canvas-fg">{children}</strong>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="my-1.5 ml-4 list-disc text-[14px] text-canvas-fg">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="my-1.5 ml-4 list-decimal text-[14px] text-canvas-fg">{children}</ol>
  ),
  a: ({ href, children }: { href?: string; children?: ReactNode }) => {
    if (!href) return <>{children}</>;
    return <LinkPreview href={href}>{children}</LinkPreview>;
  },
  img: ({ src, alt }: { src?: string | Blob; alt?: string }) => {
    if (!src || typeof src !== "string") return null;
    return <ImagePreview src={src} alt={alt} />;
  },
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
    <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
      {text}
    </Markdown>
  );
}
