"use client";

import { FiActivity } from "react-icons/fi";

interface HudIndicatorProps {
  onClick: () => void;
  isOpen: boolean;
}

/**
 * Small activity-icon button next to the context ring. Opens a popup with
 * session stats (model, tokens, cost, elapsed, turn count, active tool).
 * Styled to match ContextIndicator so the two sit flush in the toolbar.
 */
export function HudIndicator({ onClick, isOpen }: HudIndicatorProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Session stats"
      aria-expanded={isOpen}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors ${
        isOpen ? "bg-canvas-surface-hover" : "hover:bg-canvas-surface-hover"
      }`}
    >
      <FiActivity size={12} className="text-canvas-muted" />
    </button>
  );
}
