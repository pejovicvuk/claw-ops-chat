"use client";

import { useEffect, useRef, useState } from "react";
import { FiFile, FiFolder, FiLoader, FiX } from "react-icons/fi";
import { Z_INDEX } from "@/lib/z-index";

interface NewItemDialogProps {
  kind: "file" | "folder";
  /** Directory the new item will be created in — shown for context. */
  parentPath: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
  animationState?: "entering" | "open" | "exiting";
}

function isValidName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (trimmed === "." || trimmed === "..") return false;
  // Slashes make the client guess where the item lands; easier to reject
  // outright and tell the user than to silently split.
  if (/[/\\]/.test(trimmed)) return false;
  return true;
}

export function NewItemDialog({
  kind,
  parentPath,
  onSubmit,
  onCancel,
  animationState = "open",
}: NewItemDialogProps) {
  const exiting = animationState === "exiting";
  const backdropClass = exiting ? "animate-backdrop-out" : "animate-backdrop-in";
  const dialogClass = exiting ? "animate-modal-out" : "animate-modal-in";
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
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

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (submitting) return;
    if (!isValidName(name)) {
      setError("Invalid name. Avoid slashes and reserved names.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create");
      setSubmitting(false);
    }
  };

  const title = kind === "folder" ? "New folder" : "New file";
  const placeholder = kind === "folder" ? "my-folder" : "notes.md";
  const Icon = kind === "folder" ? FiFolder : FiFile;

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-[2px] ${backdropClass}`}
        style={{ zIndex: Z_INDEX.MODAL }}
        onClick={onCancel}
        aria-hidden
      />
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-item-title"
        className={`fixed left-1/2 top-1/2 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-canvas-border bg-canvas-bg p-5 shadow-2xl ${dialogClass}`}
        style={{ zIndex: Z_INDEX.MODAL + 1 }}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15">
              <Icon size={14} className="text-accent" />
            </span>
            <h3 id="new-item-title" className="text-[14px] font-semibold text-canvas-fg">
              {title}
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

        <div className="mb-3 text-[11px] text-canvas-muted">
          in{" "}
          <span className="text-canvas-fg" title={parentPath}>
            {parentPath}
          </span>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          placeholder={placeholder}
          className="mb-3 w-full rounded-md border border-canvas-border bg-canvas-surface px-3 py-2 text-[13px] text-canvas-fg outline-none focus:border-accent"
          autoComplete="off"
          spellCheck={false}
        />

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
            type="submit"
            disabled={submitting || !isValidName(name)}
            className="btn-press focus-ring flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? <FiLoader size={11} className="animate-spin" /> : <Icon size={11} />}
            {submitting ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    </>
  );
}
