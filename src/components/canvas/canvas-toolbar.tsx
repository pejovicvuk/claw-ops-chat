"use client";

import {
  FiArrowLeft,
  FiChevronLeft,
  FiChevronRight,
  FiMessageSquare,
  FiMonitor,
} from "react-icons/fi";
import type { IconType } from "react-icons";
import { TOOLBAR_H, type WindowDescriptor, type WindowKind } from "./canvas-types";
import { WindowTabs } from "./window-tabs";

interface CanvasToolbarProps {
  itemDisplayName: string;
  itemSlug: string;
  currentPage: number;
  totalPages: number;
  /** Minimized windows on the active page — rendered as auto-fit tabs. */
  minimizedWindows: WindowDescriptor[];
  onBack: () => void;
  onPageChange: (page: number) => void;
  onAdd: (kind: WindowKind) => void;
  onRestoreWindow: (id: string) => void;
  onOpenSessions?: () => void;
}

/**
 * Top bar for the per-item canvas. Layout:
 *   [back + item name]   [auto-fit tabs of minimized windows]   [page nav] [tools]
 *
 * Tabs are rendered between the title block and the page-nav so they
 * absorb the elastic middle space — when many windows are minimized
 * tabs shrink first; the title and right-hand controls stay stable.
 */
export function CanvasToolbar({
  itemDisplayName,
  itemSlug,
  currentPage,
  totalPages,
  minimizedWindows,
  onBack,
  onPageChange,
  onAdd,
  onRestoreWindow,
  onOpenSessions,
}: CanvasToolbarProps) {
  return (
    <header
      className="relative flex shrink-0 items-center gap-3 border-b border-canvas-border bg-canvas-bg px-3"
      style={{ height: TOOLBAR_H }}
    >
      <div className="flex shrink-0 items-center gap-2">
        {onOpenSessions && (
          <button
            type="button"
            onClick={onOpenSessions}
            className="btn-press flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg md:hidden"
            aria-label="Open sidebar"
          >
            <FiArrowLeft size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className="btn-press flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          aria-label="Back to project"
          title="Back to project"
        >
          <FiArrowLeft size={14} />
        </button>
        <h1 className="line-clamp-1 max-w-[180px] text-[14px] font-semibold text-canvas-fg sm:max-w-[260px]">
          {itemDisplayName}
        </h1>
        <span className="hidden shrink-0 rounded-full bg-canvas-surface-hover px-2 py-0.5 font-mono text-[10px] text-canvas-muted sm:inline-block">
          {itemSlug}
        </span>
      </div>
      <WindowTabs windows={minimizedWindows} onRestore={onRestoreWindow} />
      <div className="flex shrink-0 items-center gap-2">
        <PageNavigator current={currentPage} total={totalPages} onChange={onPageChange} />
        <ToolPalette onAdd={onAdd} />
      </div>
    </header>
  );
}

/** Window-kind → icon mapping. New kinds slot in here without touching the toolbar layout. */
const KIND_ICONS: Record<WindowKind, { icon: IconType; label: string }> = {
  chat: { icon: FiMessageSquare, label: "New chat" },
  preview: { icon: FiMonitor, label: "New preview" },
};

const KIND_ORDER: WindowKind[] = ["chat", "preview"];

function ToolPalette({ onAdd }: { onAdd: (kind: WindowKind) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-canvas-border bg-canvas-bg px-1 py-0.5">
      {KIND_ORDER.map((kind) => {
        const { icon: Icon, label } = KIND_ICONS[kind];
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onAdd(kind)}
            className="btn-press flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted hover:bg-accent hover:text-white focus-visible:bg-accent focus-visible:text-white"
            aria-label={label}
            title={label}
          >
            <Icon size={13} />
          </button>
        );
      })}
    </div>
  );
}

function PageNavigator({
  current,
  total,
  onChange,
}: {
  current: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total <= 1) return null;
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-canvas-border bg-canvas-bg px-1 py-0.5">
      <button
        type="button"
        onClick={() => onChange(current - 1)}
        disabled={current <= 0}
        className="btn-press flex h-6 w-6 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Previous page"
      >
        <FiChevronLeft size={12} />
      </button>
      <span className="px-1.5 text-[11px] font-medium text-canvas-fg">
        Page {current + 1} of {total}
      </span>
      <button
        type="button"
        onClick={() => onChange(current + 1)}
        disabled={current >= total - 1}
        className="btn-press flex h-6 w-6 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Next page"
      >
        <FiChevronRight size={12} />
      </button>
    </div>
  );
}
