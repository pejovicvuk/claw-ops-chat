"use client";

interface MetricBarProps {
  /** Percentage 0-100. `null` renders an em-dash placeholder. */
  value: number | null;
  label: string;
  /** Optional secondary value text (e.g., "412 MB / 512 MB"). Shown right of the percentage. */
  secondary?: string;
}

/**
 * Polished horizontal progress bar matching the FE server-dashboard look:
 * - 10 px uppercase label / monospace right-aligned value
 * - Color band: red ≥95, yellow ≥80, green <80 (matches FE thresholds)
 * - Smooth width transition on prop change
 */
export function MetricBar({ value, label, secondary }: MetricBarProps) {
  if (value == null) {
    return (
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-canvas-muted">
          {label}
        </span>
        <span className="text-xs text-canvas-muted">—</span>
      </div>
    );
  }
  const color =
    value >= 95
      ? "bg-[var(--mon-critical)]"
      : value >= 80
        ? "bg-[var(--mon-warning)]"
        : "bg-[var(--mon-healthy)]";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-canvas-muted">
          {label}
        </span>
        <span className="flex items-center gap-2 font-mono text-xs text-canvas-fg tabular-nums">
          {secondary ? <span className="text-[10.5px] text-canvas-muted">{secondary}</span> : null}
          {value.toFixed(1)}%
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-canvas-surface-hover"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  );
}
