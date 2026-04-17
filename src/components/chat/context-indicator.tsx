"use client";

interface ContextIndicatorProps {
  percentage: number | null;
  onClick: () => void;
  isOpen: boolean;
}

/**
 * Hollow ring that shows context usage as a red arc on a grey base ring.
 * Click to open a popup with details (managed by the parent).
 */
export function ContextIndicator({ percentage, onClick, isOpen }: ContextIndicatorProps) {
  // SVG circle geometry
  const size = 14;
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, percentage ?? 0));
  const dashOffset = circumference * (1 - pct / 100);

  const label = percentage === null ? "No data yet" : `${pct}% used`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Context usage: ${label}`}
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
        {/* Red progress arc (only rendered when we have data) */}
        {percentage !== null && pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--accent)"
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
