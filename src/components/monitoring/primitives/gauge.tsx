"use client";

import { bandStatus, type ThresholdDef } from "@/lib/monitoring/threshold";
import type { MonStatus } from "@/lib/monitoring/types";

interface GaugeProps {
  /** Numerical value (any range). */
  value: number;
  /** Lower bound. Default 0. */
  min?: number;
  /** Upper bound. Default 100. */
  max?: number;
  /** Optional thresholds to color the arc fill. */
  thresholds?: ThresholdDef;
  /** Centered label below the value. */
  label?: string;
  /** Optional unit appended to the value. */
  unit?: string;
  /** Render width in CSS px (height auto-derived). Default 96. */
  size?: number;
}

const COLOR: Record<MonStatus, string> = {
  healthy: "var(--mon-healthy)",
  warning: "var(--mon-warning)",
  critical: "var(--mon-critical)",
  unknown: "var(--mon-unknown)",
  info: "var(--mon-info)",
};

/**
 * Circular 270° gauge (SVG). Empty arc + colored progress arc + center
 * value text. No external charting library needed.
 */
export function Gauge({
  value,
  min = 0,
  max = 100,
  thresholds,
  label,
  unit = "",
  size = 96,
}: GaugeProps) {
  const range = max - min;
  const clamped = Math.max(min, Math.min(max, value));
  const pct = range > 0 ? (clamped - min) / range : 0;
  const status: MonStatus = thresholds
    ? bandStatus(((clamped - min) / range) * 100, thresholds)
    : "info";

  // 270° arc starting at south-west (135°) going clockwise to south-east (45°).
  const startAngle = 135;
  const arcAngle = 270;
  const radius = size * 0.42;
  const cx = size / 2;
  const cy = size / 2 + size * 0.04;
  const strokeWidth = Math.max(6, Math.round(size * 0.08));
  const circumference = (arcAngle / 360) * 2 * Math.PI * radius;
  const dash = pct * circumference;

  // Rotate so the gap is at the bottom and the arc starts at the lower-left.
  const rotation = startAngle;

  return (
    <div className="flex flex-col items-center justify-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${label ?? "value"}: ${clamped}${unit}`}
      >
        <g transform={`rotate(${rotation} ${cx} ${cy})`}>
          {/* Track */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="var(--canvas-surface-hover)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${2 * Math.PI * radius}`}
          />
          {/* Progress */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={COLOR[status]}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${2 * Math.PI * radius}`}
            style={{ transition: "stroke-dasharray 350ms ease-out" }}
          />
        </g>
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--canvas-fg)"
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: Math.round(size * 0.18),
            fontWeight: 600,
          }}
        >
          {Math.round(clamped)}
          {unit}
        </text>
      </svg>
      {label ? (
        <p className="mt-1 text-[10.5px] font-medium uppercase tracking-wider text-canvas-muted">
          {label}
        </p>
      ) : null}
    </div>
  );
}
