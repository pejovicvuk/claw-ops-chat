"use client";

import { useCallback } from "react";
import { FiFile, FiFileText, FiImage, FiCode } from "react-icons/fi";
import { isImageExt } from "@/lib/mime";

interface FilePathPillProps {
  path: string;
  /** When provided, clicking calls this instead of the default URL hash open. */
  onOpen?: (path: string) => void;
}

const CODE_EXT =
  /\.(ts|tsx|js|jsx|py|rs|go|java|kt|swift|rb|cpp?|h|sh|sql|html?|css|yaml?|toml|json|xml|md|mdx)$/i;

function iconFor(path: string) {
  if (isImageExt(path)) return FiImage;
  if (CODE_EXT.test(path)) return FiCode;
  if (/\.(txt|log|csv)$/i.test(path)) return FiFileText;
  return FiFile;
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Inline chip for a file path detected in tool output. Click opens the
 * file in the existing floating editor panel by mirroring the chat
 * URL params (`?open=path&active=path`) that chat-layout watches —
 * same mechanism the file browser uses.
 */
export function FilePathPill({ path, onOpen }: FilePathPillProps) {
  const Icon = iconFor(path);

  const open = useCallback(() => {
    if (onOpen) {
      onOpen(path);
      return;
    }
    // Mirror chat-layout.tsx's handleFileOpen URL pattern.
    try {
      const url = new URL(window.location.href);
      const current = url.searchParams.getAll("open");
      if (!current.includes(path)) {
        url.searchParams.append("open", path);
      }
      url.searchParams.set("active", path);
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
      // Dispatch a popstate so chat-layout's URL-state hook picks up the change.
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {
      /* fall through */
    }
  }, [path, onOpen]);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      navigator.clipboard?.writeText(path).catch(() => {});
    },
    [path],
  );

  return (
    <button
      type="button"
      onClick={open}
      onContextMenu={onContextMenu}
      title={path}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-canvas-border bg-canvas-surface px-2 py-0.5 font-mono text-[11px] text-canvas-fg transition-colors hover:bg-canvas-surface-hover"
    >
      <Icon size={11} className="shrink-0 text-canvas-muted" />
      <span className="truncate">{basename(path)}</span>
    </button>
  );
}
