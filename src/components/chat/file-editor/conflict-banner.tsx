"use client";

import { FiAlertTriangle } from "react-icons/fi";

export interface ConflictBannerProps {
  /** When true, the user has unsaved local edits — surface the data-loss risk in the labels. */
  dirty: boolean;
  /** Reload the on-disk content into the editor (drops local edits when dirty). */
  onReload: () => void;
  /** Force-write the local content over the on-disk version. */
  onOverwrite: () => void;
  /** Disable buttons during the in-flight save / reload. */
  busy?: boolean;
}

export function ConflictBanner({
  dirty,
  onReload,
  onOverwrite,
  busy = false,
}: ConflictBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200"
    >
      <FiAlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-300" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">File changed on disk</p>
        <p className="mt-0.5 text-amber-200/80">
          {dirty
            ? "Someone (or Claude) modified this file while you were editing. Reload to see their version (you'll lose your unsaved changes) or overwrite to keep yours."
            : "Reload to see the latest version, or overwrite to push your buffer back."}
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onReload}
            disabled={busy}
            className="rounded-md bg-amber-500/30 px-2 py-1 text-[11px] font-medium text-amber-100 hover:bg-amber-500/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {dirty ? "Reload (lose my changes)" : "Reload"}
          </button>
          <button
            type="button"
            onClick={onOverwrite}
            disabled={busy}
            className="rounded-md border border-amber-500/40 bg-transparent px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save anyway (overwrite)
          </button>
        </div>
      </div>
    </div>
  );
}
