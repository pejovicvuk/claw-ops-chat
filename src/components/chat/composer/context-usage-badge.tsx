"use client";

import type { ReactNode } from "react";
import type { ContextUsage } from "@/lib/use-claude-chat";
import { formatTokens } from "@/lib/format-streaming-hint";

interface ContextUsageBadgeProps {
  usage: ContextUsage | null;
}

/**
 * Compact "context used" indicator that lives just below the composer.
 * Hidden until the first turn produces a usage report; thereafter the
 * pill colour-ramps so the user can spot when they're approaching the
 * model's context limit at a glance:
 *
 *   < 80 %   muted neutral
 *   80–95 %  orange
 *   ≥ 95 %   red
 *
 * Hover surfaces the precise token totals via the native `title` tooltip
 * (kept text-based rather than a custom popover — the badge's job is to
 * be a peripheral signal, not a dashboard).
 */
export function ContextUsageBadge({ usage }: ContextUsageBadgeProps): ReactNode {
  if (!usage || typeof usage.percentage !== "number") return null;

  const pct = Math.max(0, Math.min(100, usage.percentage));
  const color = pct >= 95 ? "var(--mon-critical)" : pct >= 80 ? "var(--mon-warning)" : undefined;

  return (
    <div className="mt-1.5 flex justify-center">
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] text-canvas-muted"
        title={`${formatTokens(usage.used)} of ${formatTokens(usage.max)} tokens`}
      >
        <span className="font-medium" style={color ? { color } : undefined}>
          {pct}% context
        </span>
        <span className="text-canvas-muted/70">
          · {formatTokens(usage.used)} / {formatTokens(usage.max)}
        </span>
      </span>
    </div>
  );
}
