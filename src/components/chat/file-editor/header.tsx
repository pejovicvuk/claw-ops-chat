"use client";

import { forwardRef } from "react";
import {
  FiAlignJustify,
  FiAlignLeft,
  FiCheck,
  FiChevronRight,
  FiCopy,
  FiCornerUpLeft,
  FiEdit2,
  FiEye,
  FiHome,
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
  /** Show the View / Edit toggle button. */
  showModeToggle?: boolean;
  mode?: "view" | "edit";
  onToggleMode?: () => void;
  /** Show the line-wrap toggle (only useful in code/text view). */
  showWrapToggle?: boolean;
  wrap?: boolean;
  onToggleWrap?: () => void;
  /** Show the copy-all-content button. */
  showCopyAll?: boolean;
  copyAllOk?: boolean;
  onCopyAll?: () => void;
  /** Touch handlers used on mobile for swipe-down-to-close. */
  onTouchStart?: (e: React.TouchEvent) => void;
  onTouchEnd?: (e: React.TouchEvent) => void;
}

function segmentsFor(path: string): { label: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((part, i) => ({
    label: part,
    path: "/" + parts.slice(0, i + 1).join("/"),
  }));
}

/**
 * Shared chip styling for every clickable breadcrumb segment. Uses a
 * subtle background so the segments read as buttons even without a
 * hover state (mobile), with a clear hover + active treatment on
 * pointer devices.
 */
const SEG_CLS =
  "flex h-7 shrink-0 items-center gap-1 rounded-md bg-canvas-bg/60 px-2 text-[11px] font-medium text-canvas-muted " +
  "hover:bg-canvas-surface-hover hover:text-canvas-fg active:scale-[0.97] active:bg-canvas-surface-hover " +
  "transition-colors sm:h-6 sm:px-1.5 sm:text-[10px]";

/**
 * Editor panel header. On desktop the entire title row (minus the
 * action buttons and breadcrumb chips) is the drag handle — pointerDown
 * on the nav/chips is stopped so clicks land reliably.
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
    showModeToggle,
    mode,
    onToggleMode,
    showWrapToggle,
    wrap,
    onToggleWrap,
    showCopyAll,
    copyAllOk,
    onCopyAll,
    onTouchStart,
    onTouchEnd,
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
      className="flex shrink-0 cursor-default select-none items-center gap-2 border-b border-canvas-border bg-canvas-surface px-2 py-1.5"
      onPointerDown={onDragStart}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <nav
        aria-label="File path"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onSegmentClick("~")}
          aria-label="Home directory"
          title="Go to home"
          className={SEG_CLS}
        >
          <FiHome size={11} />
          <span className="hidden sm:inline">~</span>
        </button>
        {dirSegments.map((seg) => (
          <span key={seg.path} className="flex shrink-0 items-center gap-1">
            <FiChevronRight size={10} className="shrink-0 text-canvas-muted/60" aria-hidden />
            <button
              type="button"
              onClick={() => onSegmentClick(seg.path)}
              title={`Go to ${seg.path}`}
              className={SEG_CLS}
            >
              {seg.label}
            </button>
          </span>
        ))}
        <FiChevronRight size={10} className="shrink-0 text-canvas-muted/60" aria-hidden />
        <span
          className="flex h-7 min-w-0 shrink items-center rounded-md bg-canvas-bg px-2 text-[11px] font-semibold text-canvas-fg sm:h-6 sm:px-1.5 sm:text-[11px]"
          title={path}
          aria-current="page"
        >
          <span className="truncate">{filename}</span>
          {dirty && (
            <span
              aria-label="Unsaved changes"
              className="ml-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
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
            className="flex h-7 w-7 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg sm:h-6 sm:w-6"
          >
            <FiCornerUpLeft size={12} />
          </button>
        )}
        {showWrapToggle && onToggleWrap && (
          <button
            type="button"
            onClick={onToggleWrap}
            title={wrap ? "Disable line wrap" : "Enable line wrap"}
            aria-label={wrap ? "Disable line wrap" : "Enable line wrap"}
            aria-pressed={wrap}
            className={`flex h-7 w-7 items-center justify-center rounded hover:bg-canvas-surface-hover sm:h-6 sm:w-6 ${
              wrap ? "text-accent" : "text-canvas-muted hover:text-canvas-fg"
            }`}
          >
            {wrap ? <FiAlignJustify size={12} /> : <FiAlignLeft size={12} />}
          </button>
        )}
        {showCopyAll && onCopyAll && (
          <button
            type="button"
            onClick={onCopyAll}
            title="Copy all"
            aria-label="Copy entire file content"
            className="flex h-7 w-7 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg sm:h-6 sm:w-6"
          >
            {copyAllOk ? <FiCheck size={12} /> : <FiCopy size={12} />}
          </button>
        )}
        {showModeToggle && onToggleMode && (
          <button
            type="button"
            onClick={onToggleMode}
            title={mode === "view" ? "Edit" : "View"}
            aria-label={mode === "view" ? "Switch to edit" : "Switch to view"}
            aria-pressed={mode === "edit"}
            className={`flex h-7 w-7 items-center justify-center rounded hover:bg-canvas-surface-hover sm:h-6 sm:w-6 ${
              mode === "edit" ? "text-accent" : "text-canvas-muted hover:text-canvas-fg"
            }`}
          >
            {mode === "view" ? <FiEdit2 size={12} /> : <FiEye size={12} />}
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          title="Save (Ctrl/Cmd+S)"
          aria-label="Save"
          className="flex h-7 w-7 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-40 sm:h-6 sm:w-6"
        >
          <FiSave size={12} />
        </button>
        {onMinimize && !hideWindowControls && (
          <button
            type="button"
            onClick={onMinimize}
            title="Minimize"
            aria-label="Minimize"
            className="flex h-7 w-7 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg sm:h-6 sm:w-6"
          >
            <FiMinus size={12} />
          </button>
        )}
        {onToggleMaximize && !hideWindowControls && (
          <button
            type="button"
            onClick={onToggleMaximize}
            title={maximized ? "Restore" : "Maximize"}
            aria-label={maximized ? "Restore" : "Maximize"}
            className="flex h-7 w-7 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg sm:h-6 sm:w-6"
          >
            {maximized ? <FiMinimize2 size={11} /> : <FiMaximize2 size={11} />}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close"
          className="flex h-7 w-7 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg sm:h-6 sm:w-6"
        >
          <FiX size={12} />
        </button>
      </div>
    </div>
  );
});
