"use client";

import { useState } from "react";
import { FiArrowLeft, FiChevronLeft, FiChevronRight, FiPlus } from "react-icons/fi";
import { AddWindowMenu } from "./add-window-menu";
import { TOOLBAR_H, type WindowKind } from "./canvas-types";

interface CanvasToolbarProps {
  itemDisplayName: string;
  itemSlug: string;
  currentPage: number;
  totalPages: number;
  onBack: () => void;
  onPageChange: (page: number) => void;
  onAdd: (kind: WindowKind) => void;
  onOpenSessions?: () => void;
}

/**
 * Top bar for the per-item canvas. Left side: back arrow + item title +
 * slug pill. Right side: page navigator + accent "Add window" button
 * (which opens an inline dropdown picker).
 */
export function CanvasToolbar({
  itemDisplayName,
  itemSlug,
  currentPage,
  totalPages,
  onBack,
  onPageChange,
  onAdd,
  onOpenSessions,
}: CanvasToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      className="relative flex shrink-0 items-center justify-between gap-3 border-b border-canvas-border bg-canvas-bg px-3"
      style={{ height: TOOLBAR_H }}
    >
      <div className="flex min-w-0 items-center gap-2">
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
        <h1 className="line-clamp-1 text-[14px] font-semibold text-canvas-fg">{itemDisplayName}</h1>
        <span className="hidden shrink-0 rounded-full bg-canvas-surface-hover px-2 py-0.5 font-mono text-[10px] text-canvas-muted sm:inline-block">
          {itemSlug}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <PageNavigator current={currentPage} total={totalPages} onChange={onPageChange} />
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <FiPlus size={13} />
            Add window
          </button>
          {menuOpen && (
            <AddWindowMenu
              onPick={(kind) => {
                setMenuOpen(false);
                onAdd(kind);
              }}
              onDismiss={() => setMenuOpen(false)}
            />
          )}
        </div>
      </div>
    </header>
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
