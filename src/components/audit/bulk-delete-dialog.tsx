"use client";

import { useState } from "react";
import { FiAlertTriangle, FiLoader, FiTrash2, FiX } from "react-icons/fi";
import type { AuditCategory } from "@/lib/audit/types";
import { purgeAuditEvents } from "@/lib/use-audit";

interface BulkDeleteDialogProps {
  /** When true the dialog is rendered in "nuke everything" mode with typed-confirm. */
  nuke?: boolean;
  category?: AuditCategory;
  onClose: () => void;
  onDone: (result: { deleted: string[]; bytesFreed: number }) => void;
}

const PRESET_DAYS = [30, 14, 7, 1];

export function BulkDeleteDialog({
  nuke = false,
  category,
  onClose,
  onDone,
}: BulkDeleteDialogProps) {
  const [days, setDays] = useState<number>(30);
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canConfirm = nuke ? confirmText === "DELETE" : true;

  const run = async () => {
    if (!canConfirm || loading) return;
    setLoading(true);
    setErr(null);
    try {
      const result = nuke
        ? await purgeAuditEvents({ category })
        : await purgeAuditEvents({
            category,
            olderThan: Date.now() - days * 24 * 60 * 60 * 1000,
          });
      onDone(result);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-modal-in w-full max-w-md rounded-xl border border-canvas-border bg-canvas-bg p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center gap-2">
          <FiAlertTriangle size={16} className="text-red-500" />
          <h3 className="text-[14px] font-semibold text-canvas-fg">
            {nuke ? "Delete everything" : "Delete older logs"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiX size={14} />
          </button>
        </div>

        {nuke ? (
          <div className="space-y-3">
            <p className="text-[12px] text-canvas-muted">
              This will remove every audit log file
              {category ? (
                <>
                  {" "}
                  in the <code className="rounded bg-canvas-surface px-1">{category}</code> category
                </>
              ) : null}
              . Running logs for currently-open sessions will keep appending from scratch.
            </p>
            <p className="text-[12px] text-canvas-muted">
              Type <code className="rounded bg-canvas-surface px-1 font-mono">DELETE</code> to
              confirm:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="w-full rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px] text-canvas-fg focus:border-accent focus:outline-none"
              autoFocus
            />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] text-canvas-muted">Delete daily log files older than:</p>
            <div className="flex flex-wrap gap-2">
              {PRESET_DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  className={`rounded-md border px-3 py-1 text-[12px] transition-colors ${
                    days === d
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-canvas-border text-canvas-muted hover:bg-canvas-surface-hover"
                  }`}
                >
                  {d} day{d === 1 ? "" : "s"}
                </button>
              ))}
            </div>
            {category && (
              <p className="text-[11px] text-canvas-muted">
                Scope: <code className="rounded bg-canvas-surface px-1">{category}</code> category
                only.
              </p>
            )}
          </div>
        )}

        {err && (
          <p className="mt-3 flex items-center gap-1 text-[11px] text-red-500">
            <FiAlertTriangle size={11} />
            {err}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={run}
            disabled={!canConfirm || loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
          >
            {loading ? <FiLoader size={11} className="animate-spin" /> : <FiTrash2 size={11} />}
            {nuke ? "Delete everything" : `Delete older than ${days}d`}
          </button>
        </div>
      </div>
    </div>
  );
}
