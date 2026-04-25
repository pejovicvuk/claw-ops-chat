"use client";

import MarkdownRenderer from "@/components/chat/markdown-renderer";
import { SyntaxCode } from "@/components/chat/previews/syntax-code";
import type { PreviewKind } from "@/lib/file-preview/pick-renderer";
import type { FileEntry } from "@/lib/types";
import { BinaryPlaceholder } from "./binary-placeholder";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface ReadablePreviewProps {
  file: FileEntry;
  kind: PreviewKind;
  /** Required for `kind === "code"`. Ignored otherwise. */
  language?: string;
  /** File contents for text-ish kinds. Empty string for media/binary. */
  content: string;
  /** Wrap long lines in the code/text views. */
  wrap?: boolean;
}

/**
 * Read-only "view" surface used by the file editor panel. Switches the
 * actual rendering by `kind`:
 *   - markdown  → MarkdownRenderer (chat-style prose, file-path detection)
 *   - text      → wrapped <pre>
 *   - code      → SyntaxCode (lazy shiki, copy button)
 *   - image     → <img src=/api/files/serve>
 *   - pdf       → <iframe src=/api/files/serve>
 *   - video/audio → native <video|audio controls>
 *   - binary    → BinaryPlaceholder (download CTA)
 *
 * Always assumes its parent container handles the scroll (h-full + min-h-0).
 */
export function ReadablePreview({
  file,
  kind,
  language,
  content,
  wrap = true,
}: ReadablePreviewProps) {
  const serveUrl = `${BASE}/api/files/serve?path=${encodeURIComponent(file.path)}`;

  if (kind === "markdown") {
    return (
      <div className="prose prose-invert max-w-none px-4 py-3 text-[14px] sm:text-[13px]">
        <MarkdownRenderer text={content} />
      </div>
    );
  }

  if (kind === "text") {
    return (
      <pre
        className={`m-0 px-4 py-3 font-mono text-[12px] leading-relaxed text-canvas-fg ${
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
        }`}
      >
        {content}
      </pre>
    );
  }

  if (kind === "code") {
    return (
      <div
        className={`px-1 py-2 ${wrap ? "[&_pre]:!whitespace-pre-wrap [&_pre]:!break-words" : ""}`}
      >
        <SyntaxCode language={language ?? ""} code={content} />
      </div>
    );
  }

  if (kind === "image") {
    return (
      <div className="flex h-full items-center justify-center bg-black/20 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- inline preview, no Next/Image benefit */}
        <img
          src={serveUrl}
          alt={file.name}
          className="max-h-full max-w-full rounded border border-canvas-border object-contain"
        />
      </div>
    );
  }

  if (kind === "pdf") {
    return <iframe src={serveUrl} title={file.name} className="h-full w-full border-0" />;
  }

  if (kind === "video") {
    return (
      <div className="flex h-full items-center justify-center bg-black p-2">
        <video src={serveUrl} controls className="max-h-full max-w-full">
          <track kind="captions" />
        </video>
      </div>
    );
  }

  if (kind === "audio") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <p className="text-[13px] text-canvas-fg">{file.name}</p>
        <audio src={serveUrl} controls className="w-full max-w-md" />
      </div>
    );
  }

  return (
    <div className="h-full">
      <BinaryPlaceholder file={file} />
    </div>
  );
}
