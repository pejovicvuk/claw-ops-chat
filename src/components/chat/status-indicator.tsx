"use client";

import type { ClaudeStatus, ActiveToolInfo } from "@/lib/types";

interface StatusIndicatorProps {
  status: ClaudeStatus;
  activeTool?: ActiveToolInfo | null;
  onReconnect: () => void;
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

const LABEL: Record<ClaudeStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting...",
  idle: "Ready",
  thinking: "Thinking...",
  tool_running: "Running tool...",
  awaiting_permission: "Needs approval",
  awaiting_input: "Needs your input",
};

export function StatusIndicator({ status, activeTool, onReconnect }: StatusIndicatorProps) {
  const label = status === "tool_running" && activeTool
    ? `Running ${activeTool.name}...`
    : LABEL[status];

  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[status]}`} />
      <span className="text-[11px] text-canvas-muted">{label}</span>
      {status === "disconnected" && (
        <button
          type="button"
          onClick={onReconnect}
          className="rounded-md bg-canvas-surface-hover px-2 py-0.5 text-[11px] font-medium text-canvas-fg active:bg-canvas-border"
        >
          Reconnect
        </button>
      )}
    </div>
  );
}
