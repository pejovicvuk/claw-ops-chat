"use client";

import type { ReactNode } from "react";
import type { MonStatus } from "@/lib/monitoring/types";
import { Sparkline } from "./sparkline";

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  status?: MonStatus;
  sparkline?: number[];
  sparklineDomain?: [number, number] | "auto";
  helpText?: string;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
  rightAdornment?: ReactNode;
  onClick?: () => void;
}

const STATUS_TEXT: Record<MonStatus, string> = {
  healthy: "text-[var(--mon-healthy)]",
  warning: "text-[var(--mon-warning)]",
  critical: "text-[var(--mon-critical)]",
  unknown: "text-canvas-muted",
  info: "text-[var(--mon-info)]",
};

export function MetricCard({
  label,
  value,
  unit,
  status,
  sparkline,
  sparklineDomain,
  helpText,
  loading = false,
  size = "md",
  rightAdornment,
  onClick,
}: MetricCardProps) {
  const valueColor = status ? STATUS_TEXT[status] : "text-canvas-fg";
  const padding = size === "sm" ? "p-3" : size === "lg" ? "p-5" : "p-4";
  const valueSize = size === "sm" ? "text-[18px]" : size === "lg" ? "text-[28px]" : "text-[22px]";

  const interactive = !!onClick;

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (interactive && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={`rounded-xl border border-canvas-border bg-canvas-bg ${padding} ${
        interactive
          ? "cursor-pointer transition-colors hover:bg-canvas-surface-hover focus:outline-none focus:ring-2 focus:ring-accent/40"
          : ""
      }`}
      aria-label={`${label}: ${value}${unit ? ` ${unit}` : ""}`}
      title={helpText}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-canvas-muted">
          {label}
        </p>
        {rightAdornment ?? null}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        {loading ? (
          <span
            className={`inline-block h-7 w-20 animate-pulse rounded bg-canvas-surface-hover ${valueSize}`}
            aria-hidden="true"
          />
        ) : (
          <>
            <span className={`font-semibold tabular-nums ${valueSize} ${valueColor}`}>{value}</span>
            {unit ? <span className="text-[11px] text-canvas-muted">{unit}</span> : null}
          </>
        )}
      </div>
      {sparkline && sparkline.length > 0 ? (
        <div className="mt-2">
          <Sparkline
            values={sparkline}
            width={size === "sm" ? 80 : 120}
            height={size === "sm" ? 18 : 24}
            domain={sparklineDomain}
            ariaLabel={`${label} trend`}
            showLastPoint
          />
        </div>
      ) : null}
    </div>
  );
}
