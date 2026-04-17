"use client";

import type { ReactNode } from "react";
import { FiChevronRight } from "react-icons/fi";

export type ConnectionStatus = "connected" | "disconnected" | "coming-soon" | "unknown";

interface ConnectionRowProps {
  icon: ReactNode;
  name: string;
  description?: string;
  status: ConnectionStatus;
  onClick?: () => void;
  disabled?: boolean;
}

const STATUS_STYLES: Record<ConnectionStatus, { label: string; className: string }> = {
  connected: {
    label: "Connected",
    className: "bg-green-500/10 text-green-500",
  },
  disconnected: {
    label: "Not connected",
    className: "bg-canvas-surface-hover text-canvas-muted",
  },
  "coming-soon": {
    label: "Coming soon",
    className: "bg-canvas-surface-hover text-canvas-muted",
  },
  unknown: {
    label: "Checking...",
    className: "bg-canvas-surface-hover text-canvas-muted",
  },
};

/**
 * Row for a single integration (Claude Code, GitHub, ...) in the connections list.
 * Icon + name + optional description + status chip + chevron.
 */
export function ConnectionRow({
  icon,
  name,
  description,
  status,
  onClick,
  disabled,
}: ConnectionRowProps) {
  const statusStyle = STATUS_STYLES[status];
  const isClickable = !disabled && !!onClick;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-xl border border-canvas-border bg-canvas-surface px-4 py-3 text-left transition-colors ${
        isClickable ? "hover:bg-canvas-surface-hover" : "cursor-default"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canvas-bg text-canvas-fg">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-canvas-fg">{name}</p>
        {description && (
          <p className="mt-0.5 truncate text-[11px] text-canvas-muted">{description}</p>
        )}
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusStyle.className}`}
      >
        {statusStyle.label}
      </span>
      {isClickable && <FiChevronRight size={14} className="shrink-0 text-canvas-muted" />}
    </button>
  );
}
