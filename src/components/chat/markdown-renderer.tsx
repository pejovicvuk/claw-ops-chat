"use client";

import Markdown, { type Components } from "react-markdown";
import { harden } from "rehype-harden";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Schema } from "hast-util-sanitize";
import rehypeSlug from "rehype-slug";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkAlert from "remark-github-blockquote-alert";
import remend, { type RemendOptions } from "remend";
import type { PluggableList } from "unified";
import { Children, isValidElement, useMemo, type ReactElement, type ReactNode } from "react";
import { detectFilePaths, isLonePathLine } from "@/lib/detect-file-paths";
import { remarkDisableIndentedCode } from "@/lib/markdown/remark-disable-indented-code";
import { FileCard, ResolvedFileCard } from "./previews/file-card";
import { FilePathPill, ResolvedPathPill } from "./previews/file-path-pill";
import { ImagePreview } from "./previews/image-preview";
import { LinkPreview } from "./previews/link-preview";
import { SyntaxCode } from "./previews/syntax-code";

/**
 * Sanitisation schema extending GitHub's defaults to permit:
 *   - the `markdown-alert*` classes emitted by `remark-github-blockquote-alert`
 *   - the inline SVG icons that plugin renders alongside each alert title
 *   - `rel` / `target` on anchors (added by `rehype-harden` for safety)
 *
 * `defaultSchema` already covers GFM constructs (tables, task lists,
 * footnotes). We extend rather than replace to keep that coverage.
 *
 * Note: `hast-util-sanitize` matches `className` against each space-separated
 * token individually, so the regex needs to match a *single* class name —
 * not the joined string.
 */
const ALERT_CLASS_PATTERN = /^markdown-alert(?:-(?:note|tip|important|warning|caution|title))?$/;

const sanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "svg", "path"],
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), "rel", "target"],
    div: [...(defaultSchema.attributes?.div ?? []), ["className", ALERT_CLASS_PATTERN]],
    p: [...(defaultSchema.attributes?.p ?? []), ["className", ALERT_CLASS_PATTERN]],
    svg: ["className", "viewBox", "width", "height", "ariaHidden", "fill"],
    path: ["d", "fillRule", "clipRule"],
  },
};

/**
 * `remend` runs as a string preprocessor before parsing. It self-heals
 * incomplete markdown that arrives mid-stream (unterminated bold, unclosed
 * inline code, dangling links). KaTeX completion is left off because we
 * don't render math today and `$` is too easily confused with currency.
 */
const REMEND_OPTIONS: RemendOptions = {
  inlineKatex: false,
  katex: false,
};

// `rehype-harden` is configured permissively here: we trust the markdown
// source (Claude SDK output and authored .md files), so harden's role is
// defence-in-depth — block obviously-dangerous protocols (`javascript:`,
// `vbscript:`) and add safe `rel` attributes to outbound links — without
// stripping legitimate URLs.
const HARDEN_OPTIONS = {
  allowedLinkPrefixes: ["*"],
  allowedImagePrefixes: ["*"],
  allowedProtocols: ["*"],
  allowDataImages: true,
} as const;

const REHYPE_PLUGINS_CHAT: PluggableList = [
  [harden, HARDEN_OPTIONS],
  [rehypeSanitize, sanitizeSchema],
];
const REHYPE_PLUGINS_DOCUMENT: PluggableList = [
  [harden, HARDEN_OPTIONS],
  [rehypeSanitize, sanitizeSchema],
  rehypeSlug,
];

const REMARK_PLUGINS_CHAT: PluggableList = [
  remarkGfm,
  remarkBreaks,
  remarkAlert,
  remarkDisableIndentedCode,
];
const REMARK_PLUGINS_DOCUMENT: PluggableList = [remarkGfm, remarkBreaks, remarkAlert];

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
      return <p className="my-1 text-[16px] leading-relaxed text-canvas-fg">{transformed}</p>;
    }
    return <li className="my-0.5">{transformed}</li>;
  }

  const body = (
    <div className="my-1 space-y-2 text-[16px] leading-relaxed text-canvas-fg">
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

/**
 * Read a `<code>` element's raw children as a string. For both inline and
 * fenced code, react-markdown passes the body as either a plain string or
 * an array of string parts (no nested elements — code spans don't allow
 * inline markup). Returning the empty string for any non-text shape is a
 * defensive fallback; the caller treats "no newline found" as inline.
 */
function readCodeText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) {
    return children.filter((c): c is string => typeof c === "string").join("");
  }
  return "";
}

// Shared inline / block code renderer. Both variants use the same
// SyntaxCode + inline-code styling so syntax highlighting and the copy
// button behave identically across chat and document surfaces.
//
// Three branches:
//   1. Fenced block WITH a language tag → SyntaxCode (lazy shiki).
//   2. Fenced block WITHOUT a language tag → generic block (mono <pre>
//      inside a bordered scroll container). Detected via embedded
//      newlines, since inline code spans can't contain line breaks
//      (CommonMark §6.1). Without this branch a language-less ``` block
//      collapses into the inline-code chip — the symptom that turns
//      multi-line ASCII boxes into a tiny pink pill.
//   3. Genuine inline code → the rounded chip styling.
function inlineOrBlockCode({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}): ReactElement {
  const langMatch = /language-(\w+)/.exec(className ?? "");
  if (langMatch) {
    const code = String(children).replace(/\n$/, "");
    return <SyntaxCode language={langMatch[1]} code={code} />;
  }

  const raw = readCodeText(children);
  if (raw.includes("\n")) {
    const code = raw.replace(/\n$/, "");
    return (
      <div className="my-2 overflow-x-auto rounded-md border border-canvas-border bg-canvas-bg p-3">
        <pre className="whitespace-pre font-mono text-[12px] leading-relaxed text-canvas-fg">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return (
    <code className="rounded bg-canvas-surface-hover px-1.5 py-0.5 font-mono text-[0.875em] text-canvas-fg">
      {children}
    </code>
  );
}

// Module-level: stable reference required so react-markdown keeps its per-component cache.
const chatComponents = {
  p: ({ children }: { children?: ReactNode }) => renderBlockWithFileCards(children, "p"),
  li: ({ children }: { children?: ReactNode }) => renderBlockWithFileCards(children, "li"),
  code: inlineOrBlockCode,
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-bold text-canvas-fg">{children}</strong>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="my-1.5 ml-4 list-disc text-[16px] text-canvas-fg">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="my-1.5 ml-4 list-decimal text-[16px] text-canvas-fg">{children}</ol>
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

// Document variant: GitHub-style polished long-form layout. Used by file
// preview (.md files) and the reports viewer. No file-path / file-card
// transforms — paragraphs and list items render plain.
const documentComponents: Components = {
  h1: ({ children, id }) => (
    <h1
      id={id}
      className="mt-8 mb-4 border-b border-canvas-border pb-2 text-[28px] font-semibold leading-tight tracking-tight text-canvas-fg first:mt-0"
    >
      {children}
    </h1>
  ),
  h2: ({ children, id }) => (
    <h2
      id={id}
      className="mt-7 mb-3 border-b border-canvas-border pb-1.5 text-[22px] font-semibold leading-snug text-canvas-fg"
    >
      {children}
    </h2>
  ),
  h3: ({ children, id }) => (
    <h3 id={id} className="mt-6 mb-2 text-[18px] font-semibold leading-snug text-canvas-fg">
      {children}
    </h3>
  ),
  h4: ({ children, id }) => (
    <h4 id={id} className="mt-5 mb-2 text-[16px] font-semibold text-canvas-fg">
      {children}
    </h4>
  ),
  h5: ({ children, id }) => (
    <h5 id={id} className="mt-4 mb-1.5 text-[14px] font-semibold text-canvas-fg">
      {children}
    </h5>
  ),
  h6: ({ children, id }) => (
    <h6
      id={id}
      className="mt-4 mb-1.5 text-[13px] font-semibold uppercase tracking-wider text-canvas-muted"
    >
      {children}
    </h6>
  ),
  p: ({ children }) => <p className="my-3 leading-7 text-canvas-fg">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-3 ml-6 list-disc space-y-1 marker:text-canvas-muted">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 ml-6 list-decimal space-y-1 marker:text-canvas-muted">{children}</ol>
  ),
  li: ({ children, className }) => {
    // GFM task-list items get className="task-list-item"; render the
    // checkbox + text on a single flex row with no list marker.
    if (typeof className === "string" && className.includes("task-list-item")) {
      return <li className="-ml-6 flex list-none items-start gap-2 leading-7">{children}</li>;
    }
    return <li className="leading-7 [&>p]:my-1">{children}</li>;
  },
  input: ({ type, checked, disabled }) =>
    type === "checkbox" ? (
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        readOnly
        className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded border-canvas-border accent-accent"
      />
    ) : null,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-4 border-accent/70 bg-canvas-surface-hover/50 px-4 py-2 italic text-canvas-muted [&>p]:my-1">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-8 border-0 border-t border-canvas-border" />,
  em: ({ children }) => <em className="italic">{children}</em>,
  strong: ({ children }) => <strong className="font-semibold text-canvas-fg">{children}</strong>,
  del: ({ children }) => <del className="text-canvas-muted line-through">{children}</del>,
  code: inlineOrBlockCode,
  pre: ({ children }) => <>{children}</>,
  a: ({ href, children }) =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-words text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
      >
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  img: ({ src, alt }) => {
    if (typeof src !== "string" || !src) return null;
    return <ImagePreview src={src} alt={alt} />;
  },
  table: ({ children }) => (
    <div className="my-5 overflow-x-auto rounded-md border border-canvas-border">
      <table className="w-full border-collapse text-[14px] text-canvas-fg">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-canvas-surface-hover">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-t border-canvas-border even:bg-canvas-surface-hover/40">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-left text-[13px] font-semibold text-canvas-fg">{children}</th>
  ),
  td: ({ children }) => <td className="px-3 py-2 align-top">{children}</td>,
};

export type MarkdownVariant = "chat" | "document";

interface MarkdownRendererProps {
  text: string;
  /**
   * "chat" (default) — compact chat-tuned layout with file-path detection,
   * file cards / pills, and link unfurls. Used in assistant messages.
   *
   * "document" — polished GitHub-style long-form layout with proper heading
   * hierarchy, blockquotes, task-list checkboxes, slugged heading IDs.
   * Used by the file preview (`.md`) and the reports viewer.
   */
  variant?: MarkdownVariant;
}

export default function MarkdownRenderer({ text, variant = "chat" }: MarkdownRendererProps) {
  // Self-heal incomplete inline constructs (bold/italic/inline code/links)
  // that arrive mid-stream. Pure function of `text`; safe to memoise.
  const healed = useMemo(() => remend(text, REMEND_OPTIONS), [text]);

  if (variant === "document") {
    return (
      <div className="text-[15px] leading-7 text-canvas-fg">
        <Markdown
          remarkPlugins={REMARK_PLUGINS_DOCUMENT}
          rehypePlugins={REHYPE_PLUGINS_DOCUMENT}
          components={documentComponents}
        >
          {healed}
        </Markdown>
      </div>
    );
  }
  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS_CHAT}
      rehypePlugins={REHYPE_PLUGINS_CHAT}
      components={chatComponents}
    >
      {healed}
    </Markdown>
  );
}
