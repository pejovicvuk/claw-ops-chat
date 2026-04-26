"use client";

import type { MonStatus } from "@/lib/monitoring/types";

interface StatusBadgeProps {
  status: MonStatus;
  label?: string;
  size?: "xs" | "sm";
  className?: string;
}

const COLORS: Record<MonStatus, { bg: string; fg: string; ring: string }> = {
  healthy: {
    bg: "bg-[var(--mon-healthy)]/10",
    fg: "text-[var(--mon-healthy)]",
    ring: "ring-[var(--mon-healthy)]/20",
  },
  warning: {
    bg: "bg-[var(--mon-warning)]/10",
    fg: "text-[var(--mon-warning)]",
    ring: "ring-[var(--mon-warning)]/20",
  },
  critical: {
    bg: "bg-[var(--mon-critical)]/10",
    fg: "text-[var(--mon-critical)]",
    ring: "ring-[var(--mon-critical)]/20",
  },
  unknown: {
    bg: "bg-[var(--mon-unknown)]/10",
    fg: "text-[var(--mon-unknown)]",
    ring: "ring-[var(--mon-unknown)]/20",
  },
  info: {
    bg: "bg-[var(--mon-info)]/10",
    fg: "text-[var(--mon-info)]",
    ring: "ring-[var(--mon-info)]/20",
  },
};

const DEFAULT_LABEL: Record<MonStatus, string> = {
  healthy: "Healthy",
  warning: "Warning",
  critical: "Critical",
  unknown: "Unknown",
  info: "Info",
};

export function StatusBadge({ status, label, size = "sm", className }: StatusBadgeProps) {
  const c = COLORS[status];
  const text = label ?? DEFAULT_LABEL[status];
  const sizeCls = size === "xs" ? "h-5 px-2 text-[10px]" : "h-6 px-2.5 text-[11px]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full ring-1 ${c.bg} ${c.fg} ${c.ring} ${sizeCls} font-medium ${className ?? ""}`}
    >
      <span aria-hidden="true" className="relative flex h-1.5 w-1.5">
        <span
          className="absolute inline-flex h-full w-full rounded-full opacity-60"
          style={{ backgroundColor: "currentColor" }}
        />
        <span
          className="relative inline-flex h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: "currentColor" }}
        />
      </span>
      {text}
      <span className="sr-only"> — {DEFAULT_LABEL[status]}</span>
    </span>
  );
}
