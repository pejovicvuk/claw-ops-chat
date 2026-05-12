"use client";

import { forwardRef } from "react";
import {
  FiAlignJustify,
  FiAlignLeft,
  FiCheck,
  FiChevronRight,
  FiCopy,
  FiCornerUpLeft,
  FiDownload,
  FiHome,
  FiMaximize2,
  FiMinimize2,
  FiMinus,
  FiSave,
  FiX,
} from "react-icons/fi";
import type { DiffAgainst } from "@/lib/git/types";

export type EditorMode = "view" | "diff" | "edit";

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
  /** Show the View / Diff / Edit segmented toggle. */
  showModeToggle?: boolean;
  mode?: EditorMode;
  onChangeMode?: (mode: EditorMode) => void;
  /** When false, the Diff segment is hidden (file isn't tracked by git). */
  diffAvailable?: boolean;
  /** Active "against" choice for diff mode. */
  against?: DiffAgainst;
  onChangeAgainst?: (against: DiffAgainst) => void;
  /** Show the line-wrap toggle (only useful in code/text view). */
  showWrapToggle?: boolean;
  wrap?: boolean;
  onToggleWrap?: () => void;
  /** Show the copy-all-content button. */
  showCopyAll?: boolean;
  copyAllOk?: boolean;
  onCopyAll?: () => void;
  /** Show the download button. */
  showDownload?: boolean;
  onDownload?: () => void;
  /** True while a download is in flight — disables and shrinks the button. */
  downloadInFlight?: boolean;
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

interface ModeSegmentedProps {
  mode: EditorMode;
  onChangeMode: (m: EditorMode) => void;
  diffAvailable: boolean;
}

const SEG_BTN =
  "flex h-7 items-center justify-center px-2 text-[10px] font-medium first:rounded-l last:rounded-r " +
  "transition-colors sm:h-6 sm:px-1.5";

function ModeSegmented({ mode, onChangeMode, diffAvailable }: ModeSegmentedProps) {
  const segs: { key: EditorMode; label: string }[] = diffAvailable
    ? [
        { key: "view", label: "Content" },
        { key: "diff", label: "Diff" },
        { key: "edit", label: "Edit" },
      ]
    : [
        { key: "view", label: "Content" },
        { key: "edit", label: "Edit" },
      ];
  return (
    <div
      role="tablist"
      aria-label="Editor mode"
      className="flex items-center overflow-hidden rounded border border-canvas-border bg-canvas-bg/40"
    >
      {segs.map((s) => (
        <button
          key={s.key}
          type="button"
          role="tab"
          aria-selected={mode === s.key}
          onClick={() => onChangeMode(s.key)}
          className={`${SEG_BTN} ${
            mode === s.key
              ? "bg-canvas-surface-hover text-canvas-fg"
              : "text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

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
    onChangeMode,
    diffAvailable,
    against,
    onChangeAgainst,
    showWrapToggle,
    wrap,
    onToggleWrap,
    showCopyAll,
    copyAllOk,
    onCopyAll,
    showDownload,
    onDownload,
    downloadInFlight,
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
            className="tx-surface flex h-7 w-7 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg sm:h-6 sm:w-6"
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
            className={`tx-surface flex h-7 w-7 items-center justify-center rounded hover:bg-canvas-surface-hover sm:h-6 sm:w-6 ${
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
            className="tx-surface flex h-7 w-7 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg sm:h-6 sm:w-6"
          >
            {copyAllOk ? <FiCheck size={12} /> : <FiCopy size={12} />}
          </button>
        )}
        {showDownload && onDownload && (
          <button
            type="button"
            onClick={onDownload}
            disabled={downloadInFlight}
            title="Download"
            aria-label="Download file"
            className="tx-surface flex h-7 w-7 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-50 sm:h-6 sm:w-6"
          >
            <FiDownload size={12} />
          </button>
        )}
        {showModeToggle && onChangeMode && (
          <ModeSegmented
            mode={mode ?? "view"}
            onChangeMode={onChangeMode}
            diffAvailable={diffAvailable ?? false}
          />
        )}
        {showModeToggle && mode === "diff" && onChangeAgainst && (
          <select
            value={against ?? "working"}
            onChange={(e) => onChangeAgainst(e.target.value as DiffAgainst)}
            title="Compare against"
            aria-label="Diff target"
            className="ml-1 h-7 rounded border border-canvas-border bg-canvas-bg px-1 text-[10px] text-canvas-fg focus:outline-none sm:h-6"
          >
            <option value="working">Working</option>
            <option value="staged">Staged</option>
            <option value="head">HEAD</option>
          </select>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          title="Save (Ctrl/Cmd+S)"
          aria-label="Save"
          className="tx-surface flex h-7 w-7 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-40 sm:h-6 sm:w-6"
        >
          <FiSave size={12} />
        </button>
        {onMinimize && !hideWindowControls && (
          <button
            type="button"
            onClick={onMinimize}
            title="Minimize"
            aria-label="Minimize"
            className="tx-surface flex h-7 w-7 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg sm:h-6 sm:w-6"
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
            className="tx-surface flex h-7 w-7 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg sm:h-6 sm:w-6"
          >
            {maximized ? <FiMinimize2 size={11} /> : <FiMaximize2 size={11} />}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close"
          className="tx-surface flex h-7 w-7 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg sm:h-6 sm:w-6"
        >
          <FiX size={12} />
        </button>
      </div>
    </div>
  );
});
