"use client";

import type { RateLimitWindow } from "@/lib/account-rate-limits";
import { utilizationToPercent } from "@/lib/rate-limits-window";

interface RateLimitIndicatorProps {
  /** Short label used for the aria-name (e.g. "5-hour", "Weekly"). */
  label: string;
  /** The window data to visualise, or null when no data is available. */
  window: RateLimitWindow | null;
  onClick: () => void;
  isOpen: boolean;
}

/**
 * Hollow ring indicator for an account-level rate-limit window.
 * Same SVG geometry and click semantics as `ContextIndicator`, but the
 * arc colour reflects the window's restrictiveness:
 *
 *   - rejected (limit hit) → red
 *   - allowed_warning OR ≥80% → orange
 *   - allowed             → accent (default red highlight) — same as
 *                           the chat-context ring so visual weight is
 *                           consistent across the trio
 *
 * No data yet → grey base ring only, just like the chat ring before
 * the first message.
 */
export function RateLimitIndicator({ label, window, onClick, isOpen }: RateLimitIndicatorProps) {
  const size = 14;
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const pct = utilizationToPercent(window?.utilization);
  const status = window?.status ?? null;

  // Visual percentage: fall back to a thin sliver when status is bad
  // but utilization wasn't reported (the API headers carry status
  // without a number). That way the user still sees colour signal.
  const visualPct =
    pct !== null
      ? pct
      : status === "rejected"
        ? 100
        : status === "allowed_warning"
          ? 80
          : 0;
  const dashOffset = circumference * (1 - visualPct / 100);

  const arcColor = (() => {
    if (status === "rejected" || (pct !== null && pct >= 100)) return "var(--accent)";
    if (status === "allowed_warning" || (pct !== null && pct >= 80)) return "rgb(249 115 22)"; // tailwind orange-500
    return "var(--accent)";
  })();

  const ariaLabel =
    window === null
      ? `${label} usage: no data yet`
      : pct !== null
        ? `${label} usage: ${pct}% used`
        : `${label} usage: ${status}`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={isOpen}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors ${
        isOpen ? "bg-canvas-surface-hover" : "hover:bg-canvas-surface-hover"
      }`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Grey base ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--canvas-border)"
          strokeWidth={strokeWidth}
        />
        {/* Coloured progress arc — only when we have data */}
        {window !== null && visualPct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={arcColor}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
    </button>
  );
}
