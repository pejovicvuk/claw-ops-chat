"use client";

import { useEffect, useRef, useState } from "react";

interface ConfirmActionDialogProps {
  title: string;
  description: string;
  /** When set, the user must type this string exactly to enable Confirm. */
  confirmText?: string;
  /** Audit log subject hint (rendered as fine print). */
  auditSubject?: string;
  destructive?: boolean;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

export function ConfirmActionDialog({
  title,
  description,
  confirmText,
  auditSubject,
  destructive = false,
  confirmLabel = "Confirm",
  onConfirm,
  onClose,
}: ConfirmActionDialogProps) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [busy, onClose]);

  const canConfirm = !busy && (!confirmText || typed === confirmText);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-canvas-border bg-canvas-bg p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-title" className="text-[15px] font-semibold text-canvas-fg">
          {title}
        </h3>
        <p className="mt-2 text-[12.5px] text-canvas-muted">{description}</p>
        {confirmText ? (
          <label className="mt-4 block">
            <span className="text-[11px] text-canvas-muted">
              Type{" "}
              <code className="rounded bg-canvas-surface-hover px-1 py-0.5 font-mono text-[11px] text-canvas-fg">
                {confirmText}
              </code>{" "}
              to confirm
            </span>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="mt-1.5 block w-full rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[13px] text-canvas-fg outline-none focus:border-accent"
            />
          </label>
        ) : null}
        {auditSubject ? (
          <p className="mt-3 rounded-md bg-canvas-surface-hover px-2 py-1.5 text-[10.5px] text-canvas-muted">
            This action will be logged to the audit log as{" "}
            <code className="font-mono">{auditSubject}</code>.
          </p>
        ) : null}
        {error ? <p className="mt-3 text-[12px] text-[var(--mon-critical)]">{error}</p> : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={`rounded-lg px-3 py-2 text-[12px] font-medium transition-colors ${
              destructive
                ? "bg-[var(--mon-critical)]/10 text-[var(--mon-critical)] hover:bg-[var(--mon-critical)]/20"
                : "bg-accent/10 text-accent hover:bg-accent/20"
            } disabled:opacity-40`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
