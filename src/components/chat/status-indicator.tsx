"use client";

import type { ClaudeStatus } from "@/lib/types";

interface StatusIndicatorProps {
  status: ClaudeStatus;
  onClick: () => void;
  isOpen: boolean;
}

const DOT_CLASS: Record<ClaudeStatus, string> = {
  disconnected: "bg-red-500",
  connecting: "bg-yellow-400 animate-pulse",
  idle: "bg-green-500",
  thinking: "bg-purple-400 animate-pulse",
  tool_running: "bg-purple-400 animate-pulse",
  awaiting_permission: "bg-orange-400 animate-pulse",
  awaiting_input: "bg-blue-400 animate-pulse",
};

/**
 * Click-toggleable dot indicator for connection status.
 * The parent manages popup state (so both indicators share one popup slot).
 */
export function StatusIndicator({ status, onClick, isOpen }: StatusIndicatorProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Connection status: ${status}`}
      aria-expanded={isOpen}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors ${
        isOpen ? "bg-canvas-surface-hover" : "hover:bg-canvas-surface-hover"
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[status]}`} />
    </button>
  );
}
