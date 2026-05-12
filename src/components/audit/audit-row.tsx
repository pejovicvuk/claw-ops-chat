"use client";

import { actionColorClass } from "@/lib/audit/action-color";
import type { AuditEvent, AuditSeverity } from "@/lib/audit/types";

interface AuditRowProps {
  event: AuditEvent;
  onSelect: (event: AuditEvent) => void;
  /** When >= 0, cascades the row in with animate-empty-in delayed by index * 25 ms. */
  staggerIndex?: number;
}

function formatRelativeTime(atMs: number): string {
  const diff = Date.now() - atMs;
  if (diff < 10_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))}h ago`;
  return `${Math.floor(diff / (24 * 60 * 60_000))}d ago`;
}

function formatAbsolute(atMs: number): string {
  return new Date(atMs).toISOString().replace("T", " ").slice(0, 19);
}

function severityDotClass(sev: AuditSeverity): string {
  if (sev === "error") return "bg-red-500";
  if (sev === "warn") return "bg-yellow-500";
  return "bg-canvas-muted";
}

function categoryPillClass(cat: AuditEvent["category"]): string {
  if (cat === "api") return "bg-blue-500/10 text-blue-500";
  if (cat === "cron") return "bg-purple-500/10 text-purple-500";
  if (cat === "alert") return "bg-orange-500/10 text-orange-500";
  return "bg-green-500/10 text-green-500";
}

export function AuditRow({ event, onSelect, staggerIndex = -1 }: AuditRowProps) {
  const animClass = staggerIndex >= 0 ? "animate-empty-in" : "";
  const animStyle: React.CSSProperties | undefined =
    staggerIndex >= 0 ? { animationDelay: `${staggerIndex * 25}ms` } : undefined;
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      style={animStyle}
      className={`flex w-full items-center gap-3 border-b border-canvas-border px-3 py-2 text-left transition-colors hover:bg-canvas-surface-hover ${animClass}`}
    >
      <span
        title={formatAbsolute(event.at)}
        className="w-[72px] shrink-0 font-mono text-[10.5px] text-canvas-muted"
      >
        {formatRelativeTime(event.at)}
      </span>
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${categoryPillClass(event.category)}`}
      >
        {event.category}
      </span>
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${severityDotClass(event.severity)}`}
        aria-label={event.severity}
      />
      <span className={`min-w-0 flex-1 truncate text-[12px] ${actionColorClass(event.subject)}`}>
        {event.subject}
      </span>
      {event.durationMs !== null && (
        <span className="shrink-0 font-mono text-[10.5px] text-canvas-muted">
          {event.durationMs}ms
        </span>
      )}
    </button>
  );
}
