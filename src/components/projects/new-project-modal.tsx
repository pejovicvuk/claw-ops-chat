"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FiX } from "react-icons/fi";
import { ProjectsApiError, createProjectApi, type ProjectMeta } from "@/lib/projects-api";
import { validateDisplayName } from "@/lib/projects/validation";
import { Z_INDEX } from "@/lib/z-index";

interface NewProjectModalProps {
  onClose: () => void;
  onCreated: (project: ProjectMeta) => void;
  /** Drives enter/exit animation classes — supplied by a parent useExitAnimation. */
  animationState?: "entering" | "open" | "exiting";
}

/**
 * Centered single-input modal for creating a project. NOT a drawer — a
 * full editor drawer would be overkill for a single text field. The
 * validation hint mirrors `validateDisplayName` so client and server
 * agree on what's acceptable.
 */
export function NewProjectModal({
  onClose,
  onCreated,
  animationState = "open",
}: NewProjectModalProps) {
  const exiting = animationState === "exiting";
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const validation = useMemo(() => validateDisplayName(name), [name]);
  // Empty input is "not yet validated" — don't flash a red error before the
  // user has typed anything. Show the muted hint with the slug preview instead.
  const showInlineError = name.trim().length > 0 && !validation.ok;

  const handleSubmit = useCallback(async () => {
    if (!validation.ok || submitting) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const project = await createProjectApi(name.trim());
      onCreated(project);
    } catch (err) {
      if (err instanceof ProjectsApiError) {
        setServerError(err.message);
      } else {
        setServerError(err instanceof Error ? err.message : "Failed to create project");
      }
      setSubmitting(false);
    }
  }, [name, onCreated, submitting, validation.ok]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 flex items-start justify-center px-4 pt-24"
      style={{ zIndex: Z_INDEX.MODAL }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] ${exiting ? "animate-backdrop-out" : "animate-backdrop-in"}`}
      />
      <div
        className={`relative w-full max-w-md rounded-xl border border-canvas-border bg-canvas-bg p-5 shadow-2xl ${exiting ? "animate-modal-out" : "animate-modal-in"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-heading"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id="new-project-heading" className="text-[15px] font-semibold text-canvas-fg">
            New project
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn-press flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
            aria-label="Close"
          >
            <FiX size={14} />
          </button>
        </div>
        <p className="mt-1 text-[12px] text-canvas-muted">
          Each project is a folder on this device.
        </p>

        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <label htmlFor="project-name" className="block text-[12px] font-medium text-canvas-fg">
            Project name
          </label>
          <input
            id="project-name"
            type="text"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (serverError) setServerError(null);
            }}
            disabled={submitting}
            placeholder="e.g. My Cool Project"
            className="mt-1.5 w-full rounded-lg border border-canvas-border bg-canvas-surface-hover px-3 py-2 text-[13px] text-canvas-fg outline-none focus:border-canvas-fg disabled:opacity-60"
          />
          <div className="mt-1.5 min-h-4 text-[11px]">
            {showInlineError ? (
              <span className="text-red-500">{validation.error}</span>
            ) : validation.ok ? (
              <span className="text-canvas-muted">
                Folder will be: <span className="font-mono text-canvas-fg">{validation.slug}</span>
              </span>
            ) : (
              <span className="text-canvas-muted">
                Letters, numbers, spaces, hyphens — up to 64 characters.
              </span>
            )}
          </div>
          {serverError && (
            <p className="mt-2 rounded-md bg-red-500/10 px-3 py-2 text-[12px] text-red-500">
              {serverError}
            </p>
          )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="btn-press rounded-lg px-3 py-1.5 text-[13px] text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!validation.ok || submitting}
              className="btn-press rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
