"use client";

import { forwardRef, useCallback, useRef } from "react";
import { useLongPress } from "@/lib/use-long-press";
import type { FileEntry } from "@/lib/types";
import type { GitFileStatus } from "@/lib/git/types";
import { FileIcon } from "./file-icon";

interface FileRowProps {
  entry: FileEntry;
  /** Optional git status used to color the filename. */
  gitStatus?: GitFileStatus | null;
  onClick: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function statusClass(status: GitFileStatus | null | undefined): string {
  switch (status) {
    case "untracked":
      return "text-green-500";
    case "deleted":
      return "text-red-400 line-through";
    case "modified":
    case "staged":
    case "renamed":
    case "conflicted":
      return "text-yellow-500";
    default:
      return "text-canvas-fg";
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} M`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} G`;
}

function formatMtime(mtime: number | undefined): string {
  if (!mtime) return "";
  const diff = Date.now() - mtime;
  if (diff < 0) return new Date(mtime).toLocaleDateString();
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return "just now";
  if (diff < hour) return `${Math.floor(diff / min)} min ago`;
  if (diff < day) return `${Math.floor(diff / hour)} h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} d ago`;
  return new Date(mtime).toLocaleDateString();
}

export const FileRow = forwardRef<HTMLButtonElement, FileRowProps>(function FileRow(
  { entry, gitStatus, onClick, onDoubleClick, onContextMenu },
  ref,
) {
  // Local ref so the long-press handler can read the row's bounding
  // rect to position the context menu next to the file (rather than at
  // the arbitrary touch coordinate, which on a phone often lands near
  // the row's bottom edge and pushes the menu off-screen).
  const localRef = useRef<HTMLButtonElement | null>(null);
  const composedRef = useCallback(
    (node: HTMLButtonElement | null) => {
      localRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // Long-press → context menu, mirroring desktop right-click. The hook
  // also cancels on finger drift so list scrolling doesn't trigger the
  // menu, and suppresses the follow-up click via guardClick.
  const longPress = useLongPress(() => {
    const rect = localRef.current?.getBoundingClientRect();
    // Anchor to the row: just below its left edge. The menu's own
    // viewport-clamping logic (in file-browser.tsx) will flip it above
    // the row when there is no room below.
    const x = rect ? rect.left + 8 : 0;
    const y = rect ? rect.bottom : 0;
    onContextMenu({
      preventDefault: () => {},
      stopPropagation: () => {},
      clientX: x,
      clientY: y,
    } as unknown as React.MouseEvent);
  });

  const handleClick = useCallback(() => {
    onClick();
  }, [onClick]);
  const guardedClick = longPress.guardClick(handleClick);

  return (
    <button
      ref={composedRef}
      type="button"
      onClick={guardedClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onTouchStart={longPress.onTouchStart}
      onTouchMove={longPress.onTouchMove}
      onTouchEnd={longPress.onTouchEnd}
      onTouchCancel={longPress.onTouchCancel}
      onKeyDown={(e) => {
        if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
          e.preventDefault();
          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
          onContextMenu({
            preventDefault: () => {},
            clientX: rect.left + 12,
            clientY: rect.bottom,
          } as unknown as React.MouseEvent);
        }
      }}
      title={entry.path}
      className="group row-hover flex w-full min-h-[36px] items-center gap-2 px-3 py-1.5 text-left hover:bg-canvas-surface-hover focus-visible:bg-canvas-surface-hover focus-visible:outline-none sm:min-h-0"
    >
      <FileIcon entry={entry} />
      <span className={`min-w-0 flex-1 truncate text-[12px] ${statusClass(gitStatus)}`}>
        {entry.name}
      </span>
      {!entry.directory && (
        <span className="shrink-0 text-[10px] tabular-nums text-canvas-muted">
          {formatSize(entry.size)}
        </span>
      )}
      {entry.mtime !== undefined && entry.mtime > 0 && (
        <span className="hidden shrink-0 text-[10px] text-canvas-muted/70 sm:inline">
          {formatMtime(entry.mtime)}
        </span>
      )}
    </button>
  );
});
