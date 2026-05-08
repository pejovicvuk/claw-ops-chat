"use client";

import type { ReactNode } from "react";
import { FiFileText, FiMessageCircle } from "react-icons/fi";

interface DocumentsMainPaneProps {
  /** Mobile-only: lets the placeholder open the sessions drawer. */
  onOpenSessions?: () => void;
}

/**
 * Placeholder for the upcoming Documents view. Wired into the main-pane
 * router (`?view=documents`) so the new sidebar nav can navigate to it
 * before the real feature lands.
 */
export function DocumentsMainPane({ onOpenSessions }: DocumentsMainPaneProps): ReactNode {
  return (
    <div className="flex h-full flex-col">
      {onOpenSessions && (
        <header className="flex h-12 shrink-0 items-center border-b border-canvas-border px-3 md:hidden">
          <button
            type="button"
            onClick={onOpenSessions}
            className="btn-press flex h-8 w-8 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
            aria-label="Open sessions"
          >
            <FiMessageCircle size={16} />
          </button>
          <span className="ml-2 text-[14px] font-semibold text-canvas-fg">Documents</span>
        </header>
      )}
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full border"
          style={{ borderColor: "var(--canvas-border)" }}
        >
          <FiFileText size={28} className="text-canvas-muted" />
        </div>
        <h1 className="mt-5 text-[22px] font-semibold tracking-tight text-canvas-fg">Documents</h1>
        <p className="mt-2 max-w-md text-[14px] leading-relaxed text-canvas-muted">
          Browse, search, and edit all your documents in one place. This view is coming soon.
        </p>
      </div>
    </div>
  );
}
