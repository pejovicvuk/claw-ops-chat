"use client";

import { forwardRef } from "react";
import {
  FiChevronRight,
  FiCornerUpLeft,
  FiMaximize2,
  FiMinimize2,
  FiMinus,
  FiSave,
  FiX,
} from "react-icons/fi";

interface HeaderProps {
  path: string;
  dirty: boolean;
  saving: boolean;
  maximized?: boolean;
  hideWindowControls?: boolean;
  onSegmentClick: (path: string) => void;
  onSave: () => void;
  onClose: () => void;
  onMinimize?: () => void;
  onToggleMaximize?: () => void;
  onReveal?: () => void;
  /** Invoked by pointerDown on the drag-handle region (desktop). */
  onDragStart?: (e: React.PointerEvent) => void;
}

function segmentsFor(path: string): { label: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  // Last part is the filename; render it separately without click navigation
  // to its own path (which would try to list a file as a directory).
  return parts.map((part, i) => ({
    label: part,
    path: "/" + parts.slice(0, i + 1).join("/"),
  }));
}

/**
 * Editor panel header. On desktop the entire title row (minus the action
 * buttons) is the drag handle.
 */
export const EditorHeader = forwardRef<HTMLDivElement, HeaderProps>(function EditorHeader(
  {
    path,
    dirty,
    saving,
    maximized,
    hideWindowControls,
    onSegmentClick,
    onSave,
    onClose,
    onMinimize,
    onToggleMaximize,
    onReveal,
    onDragStart,
  },
  ref,
) {
  const segments = segmentsFor(path);
  const dirSegments = segments.slice(0, -1);
  const filename = segments[segments.length - 1]?.label ?? path;
  const parentPath = dirSegments[dirSegments.length - 1]?.path ?? "~";

  return (
    <div
      ref={ref}
      className="flex shrink-0 cursor-default items-center gap-1 border-b border-canvas-border bg-canvas-surface px-2 py-1.5 select-none"
      onPointerDown={onDragStart}
    >
      <nav
        aria-label="File path"
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto no-scrollbar"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onSegmentClick("~")}
          className="shrink-0 rounded px-1 py-0.5 text-[10px] text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
        >
          ~
        </button>
        {dirSegments.map((seg) => (
          <span key={seg.path} className="flex shrink-0 items-center gap-0.5">
            <FiChevronRight size={9} className="text-canvas-muted/50" aria-hidden />
            <button
              type="button"
              onClick={() => onSegmentClick(seg.path)}
              className="rounded px-1 py-0.5 text-[10px] text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
            >
              {seg.label}
            </button>
          </span>
        ))}
        <FiChevronRight size={9} className="shrink-0 text-canvas-muted/50" aria-hidden />
        <span
          className="min-w-0 truncate rounded px-1 py-0.5 text-[11px] font-medium text-canvas-fg"
          title={path}
        >
          {filename}
          {dirty && (
            <span
              aria-label="Unsaved changes"
              className="ml-1 inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-accent align-middle"
            />
          )}
        </span>
      </nav>

      <div
        className="flex shrink-0 items-center gap-0.5"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {onReveal && (
          <button
            type="button"
            onClick={() => onReveal()}
            title={`Reveal in browser (${parentPath})`}
            aria-label="Reveal in file browser"
            className="flex h-6 w-6 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiCornerUpLeft size={11} />
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          title="Save (Ctrl/Cmd+S)"
          aria-label="Save"
          className="flex h-6 w-6 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-40"
        >
          <FiSave size={11} />
        </button>
        {onMinimize && !hideWindowControls && (
          <button
            type="button"
            onClick={onMinimize}
            title="Minimize"
            aria-label="Minimize"
            className="flex h-6 w-6 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiMinus size={11} />
          </button>
        )}
        {onToggleMaximize && !hideWindowControls && (
          <button
            type="button"
            onClick={onToggleMaximize}
            title={maximized ? "Restore" : "Maximize"}
            aria-label={maximized ? "Restore" : "Maximize"}
            className="flex h-6 w-6 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            {maximized ? <FiMinimize2 size={10} /> : <FiMaximize2 size={10} />}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close"
          className="flex h-6 w-6 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
        >
          <FiX size={11} />
        </button>
      </div>
    </div>
  );
});
