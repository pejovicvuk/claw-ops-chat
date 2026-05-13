"use client";

import { useState } from "react";
import type { RunLogEvent } from "@/lib/reports-api";

/**
 * Shared structured-event timeline used by both the live run viewer
 * (polls fetchRunLog while a run is in progress) and the post-run
 * "Activity log" toggle inside ReportViewer. Extracted from
 * live-run-viewer.tsx so the two surfaces stay visually identical.
 */

export function RunTimeline({ events }: { events: RunLogEvent[] }) {
  return (
    <div className="space-y-1.5">
      {events.map((event, idx) => (
        <TimelineRow key={idx} event={event} />
      ))}
    </div>
  );
}

export function TimelineRow({ event }: { event: RunLogEvent }) {
  const [expanded, setExpanded] = useState(false);
  const time = event.at ? new Date(event.at).toLocaleTimeString() : "";

  const { title, body, expandable, color } = describeEvent(event);

  return (
    <div
      className="rounded-lg border border-canvas-border/50 bg-canvas-surface-hover/30 px-3 py-2 text-[12px]"
      style={color ? { borderLeftColor: color, borderLeftWidth: 3 } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-canvas-fg">{title}</span>
            <span className="text-[10px] text-canvas-muted">{time}</span>
          </div>
          {body && !expandable && (
            <div className="mt-1 line-clamp-6 whitespace-pre-wrap font-mono text-[11px] text-canvas-muted">
              {body}
            </div>
          )}
          {body && expandable && expanded && (
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-canvas-muted">
              {body}
            </pre>
          )}
        </div>
        {expandable && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 text-[10px] text-accent hover:underline"
          >
            {expanded ? "hide" : "show"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Translate a raw SDK event into a display-friendly description. Matches
 * the set of event types server.ts broadcasts (tool_use_start,
 * tool_use_complete, tool_result, text_delta, result, turn_start,
 * turn_end, status, error). Unknown types fall back to a JSON dump.
 */
export function describeEvent(event: RunLogEvent): {
  title: string;
  body: string;
  expandable: boolean;
  color: string | null;
} {
  switch (event.type) {
    case "tool_use_start":
    case "tool_use_complete": {
      const name = (event.name as string) || "Tool";
      const input = event.input;
      const body = typeof input === "object" ? JSON.stringify(input, null, 2) : String(input ?? "");
      return {
        title: `${event.type === "tool_use_start" ? "→" : "✓"} ${name}`,
        body,
        expandable: body.length > 120,
        color: "#c084fc",
      };
    }
    case "tool_result": {
      const content = String(event.content ?? "");
      const isError = Boolean(event.isError);
      return {
        title: isError ? "⚠ Tool error" : "← Tool result",
        body: content,
        expandable: content.length > 200,
        color: isError ? "#f87171" : "#34d399",
      };
    }
    case "text_delta":
      return {
        title: "Assistant text",
        body: String(event.text ?? ""),
        expandable: false,
        color: "#60a5fa",
      };
    case "turn_start":
      return { title: "Turn started", body: "", expandable: false, color: "#60a5fa" };
    case "turn_end":
      return {
        title: event.isError ? "Turn ended with error" : "Turn complete",
        body: "",
        expandable: false,
        color: event.isError ? "#f87171" : "#34d399",
      };
    case "result":
      return {
        title: event.isError ? "Run failed" : "Run complete",
        body: String(event.text ?? ""),
        expandable: true,
        color: event.isError ? "#f87171" : "#34d399",
      };
    case "status":
      return {
        title: `Status: ${event.status ?? "?"}`,
        body: "",
        expandable: false,
        color: null,
      };
    case "error":
      return {
        title: "Error",
        body: String(event.message ?? JSON.stringify(event)),
        expandable: true,
        color: "#f87171",
      };
    default:
      return {
        title: event.type,
        body: JSON.stringify(event, null, 2),
        expandable: true,
        color: null,
      };
  }
}
