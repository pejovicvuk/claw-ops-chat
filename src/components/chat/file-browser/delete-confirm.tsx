"use client";

import { useEffect, useRef, useState } from "react";
import { FiAlertTriangle, FiLoader, FiTrash2, FiX } from "react-icons/fi";
import { Z_INDEX } from "@/lib/z-index";
import type { FileEntry } from "@/lib/types";

interface DeleteConfirmProps {
  entry: FileEntry;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
  /** Optional helper: resolved entry count for a directory, if known. */
  entryCount?: number | null;
  /** Optional: blocking error text shown inline. */
  error?: string | null;
  /** Drives enter/exit animation classes — supplied by a parent useExitAnimation. */
  animationState?: "entering" | "open" | "exiting";
}

export function DeleteConfirm({
  entry,
  onConfirm,
  onCancel,
  entryCount,
  error,
  animationState = "open",
}: DeleteConfirmProps) {
  const exiting = animationState === "exiting";
  const backdropClass = exiting ? "animate-backdrop-out" : "animate-backdrop-in";
  const dialogClass = exiting ? "animate-modal-out" : "animate-modal-in";
  const [submitting, setSubmitting] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    deleteRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-[2px] ${backdropClass}`}
        style={{ zIndex: Z_INDEX.MODAL }}
        onClick={onCancel}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        className={`fixed left-1/2 top-1/2 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-canvas-border bg-canvas-bg p-5 shadow-2xl ${dialogClass}`}
        style={{ zIndex: Z_INDEX.MODAL + 1 }}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/15">
              <FiTrash2 size={14} className="text-red-400" />
            </span>
            <h3 id="delete-title" className="text-[14px] font-semibold text-canvas-fg">
              Delete {entry.directory ? "folder" : "file"}?
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiX size={14} />
          </button>
        </div>

        <div className="mb-4 space-y-1 text-[12px] text-canvas-muted">
          <p className="truncate text-canvas-fg" title={entry.path}>
            {entry.name}
          </p>
          <p className="truncate text-[11px]" title={entry.path}>
            {entry.path}
          </p>
          {entry.directory ? (
            <p className="mt-2 flex items-center gap-1.5 text-orange-400">
              <FiAlertTriangle size={11} />
              Folder contents
              {entryCount !== undefined && entryCount !== null
                ? ` (${entryCount} ${entryCount === 1 ? "entry" : "entries"})`
                : ""}{" "}
              will be deleted recursively.
            </p>
          ) : (
            <p>
              Size <span className="text-canvas-fg">{entry.size} B</span>
            </p>
          )}
        </div>

        {error && (
          <p className="mb-3 rounded-md border border-red-500/20 bg-red-500/10 p-2 text-[11px] text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="btn-press focus-ring rounded-lg border border-canvas-border px-3 py-1.5 text-[12px] font-medium text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            ref={deleteRef}
            type="button"
            onClick={handleConfirm}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleConfirm();
            }}
            disabled={submitting}
            className="btn-press focus-ring flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-red-600 disabled:opacity-50"
          >
            {submitting ? <FiLoader size={11} className="animate-spin" /> : <FiTrash2 size={11} />}
            {submitting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </>
  );
}
