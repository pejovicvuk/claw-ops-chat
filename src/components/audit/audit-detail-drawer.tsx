"use client";

import { useState } from "react";
import { FiCheck, FiCopy, FiX } from "react-icons/fi";
import type { AuditEvent } from "@/lib/audit/types";

interface AuditDetailDrawerProps {
  event: AuditEvent | null;
  onClose: () => void;
}

export function AuditDetailDrawer({ event, onClose }: AuditDetailDrawerProps) {
  const [copied, setCopied] = useState(false);
  if (!event) return null;

  const json = JSON.stringify(event, null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked in some browsers — silent */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-stretch justify-end bg-black/30"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-modal-in flex w-full max-w-md flex-col border-l border-canvas-border bg-canvas-bg"
      >
        <div className="flex items-center justify-between border-b border-canvas-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-canvas-muted">
              {event.category} · {event.severity}
            </div>
            <div className="truncate text-[13px] font-medium text-canvas-fg">{event.subject}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail"
            className="flex h-7 w-7 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiX size={14} />
          </button>
        </div>

        <div className="flex items-center justify-between border-b border-canvas-border px-4 py-2">
          <span className="font-mono text-[10.5px] text-canvas-muted">
            {new Date(event.at).toISOString()}
            {event.durationMs !== null ? ` · ${event.durationMs}ms` : ""}
          </span>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded-md border border-canvas-border px-2 py-1 text-[11px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            {copied ? <FiCheck size={11} /> : <FiCopy size={11} />}
            {copied ? "Copied" : "Copy JSON"}
          </button>
        </div>

        <pre className="flex-1 overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-[11px] text-canvas-fg">
          {json}
        </pre>
      </div>
    </div>
  );
}
