"use client";

import { FiX } from "react-icons/fi";
import type { DownloadProgress as DownloadProgressState } from "@/lib/use-download";

interface DownloadProgressProps {
  progress: DownloadProgressState | null;
  onCancel: () => void;
}

/**
 * Footer card showing download progress. Mirrors the existing
 * batch-upload progress UI so both feel like the same affordance.
 */
export function DownloadProgress({ progress, onCancel }: DownloadProgressProps) {
  if (!progress) return null;
  const pct = Math.round(progress.fraction * 100);
  return (
    <div className="shrink-0 border-t border-canvas-border bg-canvas-surface/60 p-2">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="min-w-0 flex-1 truncate text-canvas-fg">
          Downloading
          <span className="ml-1 text-canvas-muted" title={progress.filename}>
            — {progress.filename}
          </span>
        </span>
        <span className="shrink-0 tabular-nums text-canvas-muted">{pct}%</span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel download"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
        >
          <FiX size={10} />
        </button>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-canvas-border">
        <div
          className="h-full bg-accent transition-[width] duration-100"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
