"use client";

import type { MonStatus } from "@/lib/monitoring/types";

const COLOR: Record<MonStatus, string> = {
  healthy: "var(--mon-healthy)",
  warning: "var(--mon-warning)",
  critical: "var(--mon-critical)",
  unknown: "var(--mon-unknown)",
  info: "var(--mon-info)",
};

const LABEL: Record<MonStatus, string> = {
  healthy: "healthy",
  warning: "warning",
  critical: "critical",
  unknown: "unknown",
  info: "info",
};

interface StatusDotProps {
  status: MonStatus;
  size?: number;
  pulse?: boolean;
}

export function StatusDot({ status, size = 8, pulse = false }: StatusDotProps) {
  return (
    <span
      role="img"
      aria-label={LABEL[status]}
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
    >
      {pulse && status !== "healthy" ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-ping rounded-full opacity-50"
          style={{ backgroundColor: COLOR[status] }}
        />
      ) : null}
      <span
        aria-hidden="true"
        className="relative inline-block rounded-full"
        style={{ width: size, height: size, backgroundColor: COLOR[status] }}
      />
    </span>
  );
}
