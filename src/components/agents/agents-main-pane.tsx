"use client";

import type { ReactNode } from "react";
import { FiCpu, FiMessageCircle } from "react-icons/fi";

interface AgentsMainPaneProps {
  /** Mobile-only: lets the placeholder open the sessions drawer. */
  onOpenSessions?: () => void;
}

/**
 * Placeholder for the upcoming Agents view. Wired into the main-pane
 * router (`?view=agents`) so the new sidebar nav can navigate to it
 * before the real feature lands.
 */
export function AgentsMainPane({ onOpenSessions }: AgentsMainPaneProps): ReactNode {
  return (
    <div className="flex h-full flex-col">
      {onOpenSessions && (
        <header className="pt-safe-top flex shrink-0 items-center border-b border-canvas-border px-3 pb-2 md:hidden">
          <button
            type="button"
            onClick={onOpenSessions}
            className="btn-press flex h-8 w-8 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
            aria-label="Open sessions"
          >
            <FiMessageCircle size={16} />
          </button>
          <span className="ml-2 text-[14px] font-semibold text-canvas-fg">Agents</span>
        </header>
      )}
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full border"
          style={{ borderColor: "var(--canvas-border)" }}
        >
          <FiCpu size={28} className="text-canvas-muted" />
        </div>
        <h1 className="mt-5 text-[22px] font-semibold tracking-tight text-canvas-fg">Agents</h1>
        <p className="mt-2 max-w-md text-[14px] leading-relaxed text-canvas-muted">
          Configure and orchestrate Claude subagents from a single place. This view is coming soon.
        </p>
      </div>
    </div>
  );
}
