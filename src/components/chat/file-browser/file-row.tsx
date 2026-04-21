"use client";

import { forwardRef } from "react";
import type { FileEntry } from "@/lib/types";
import { FileIcon } from "./file-icon";

interface FileRowProps {
  entry: FileEntry;
  onClick: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
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
  { entry, onClick, onDoubleClick, onContextMenu },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
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
      <span className="min-w-0 flex-1 truncate text-[12px] text-canvas-fg">{entry.name}</span>
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
