"use client";

import { bandStatus, type ThresholdDef } from "@/lib/monitoring/threshold";
import type { MonStatus } from "@/lib/monitoring/types";

interface ThresholdBarProps {
  /** 0-100. */
  value: number;
  thresholds?: ThresholdDef;
  label?: string;
  height?: number;
}

const COLOR: Record<MonStatus, string> = {
  healthy: "var(--mon-healthy)",
  warning: "var(--mon-warning)",
  critical: "var(--mon-critical)",
  unknown: "var(--mon-unknown)",
  info: "var(--mon-info)",
};

export function ThresholdBar({ value, thresholds, label, height = 8 }: ThresholdBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const status = thresholds ? bandStatus(clamped, thresholds) : "info";
  return (
    <div className="w-full">
      {label ? (
        <div className="mb-1 flex items-center justify-between text-[11px] text-canvas-muted">
          <span>{label}</span>
          <span className="tabular-nums" style={{ color: COLOR[status] }}>
            {clamped.toFixed(1)}%
          </span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-label={label}
        className="overflow-hidden rounded-full bg-canvas-surface-hover"
        style={{ height }}
      >
        <div
          className="h-full transition-[width] duration-300 ease-out"
          style={{ width: `${clamped}%`, backgroundColor: COLOR[status] }}
        />
      </div>
    </div>
  );
}
