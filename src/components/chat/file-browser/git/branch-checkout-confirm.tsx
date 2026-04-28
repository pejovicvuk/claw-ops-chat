"use client";

import { FiAlertTriangle } from "react-icons/fi";
import type { SessionBranchSnapshot } from "@/lib/session-branches";

interface BranchCheckoutConfirmProps {
  branchName: string;
  sessions: SessionBranchSnapshot[];
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Lightweight modal warning the user that another chat is already on
 * the branch they're about to switch to. Reuses the modal animation
 * vocabulary used elsewhere (session delete-confirm, etc.).
 */
export function BranchCheckoutConfirm({
  branchName,
  sessions,
  onConfirm,
  onCancel,
}: BranchCheckoutConfirmProps) {
  return (
    <div
      className="fixed inset-0 z-[9998] flex animate-fade-in items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="mx-4 w-full max-w-sm animate-modal-in rounded-xl border border-canvas-border bg-canvas-bg p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Confirm branch checkout"
      >
        <div className="mb-3 flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ backgroundColor: "color-mix(in srgb, #fbbf24 15%, transparent)" }}
          >
            <FiAlertTriangle size={14} className="text-amber-400" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-canvas-fg">Branch in use</p>
            <p className="text-[11px] text-canvas-muted">
              Another chat is already running on{" "}
              <span className="font-mono text-canvas-fg">{branchName}</span>.
            </p>
          </div>
        </div>

        <div className="mb-4 max-h-32 space-y-1 overflow-y-auto rounded-md border border-canvas-border bg-canvas-surface-hover px-3 py-2">
          {sessions.map((s) => (
            <p key={s.sessionId} className="line-clamp-1 text-[12px] text-canvas-fg">
              {s.display}
            </p>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-amber-500/90 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-amber-500"
          >
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  );
}
