"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiArrowLeft } from "react-icons/fi";
import { createFolderItemApi, importRepoItemApi, type ItemMeta } from "@/lib/items-api";
import { ProjectsApiError } from "@/lib/projects-api";
import { validateDisplayName, validateRepoUrl, type RepoKind } from "@/lib/projects/validation";

export type FormKind = "folder" | RepoKind;

interface ItemFormProps {
  projectSlug: string;
  kind: FormKind;
  onCreated: (item: ItemMeta) => void;
  onBack: () => void;
}

/**
 * Single-input form for any item kind. For `folder` it's a free-form
 * display name with the same slug-preview affordance as `new-project-modal`;
 * for `github`/`bitbucket` it's an https URL with a derived "Folder will
 * be" preview.
 */
export function ItemForm({ projectSlug, kind, onCreated, onBack }: ItemFormProps) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const folderValidation = useMemo(
    () => (kind === "folder" ? validateDisplayName(value) : null),
    [kind, value],
  );
  const repoValidation = useMemo(
    () => (kind === "folder" ? null : validateRepoUrl(kind, value)),
    [kind, value],
  );
  const isValid = kind === "folder" ? Boolean(folderValidation?.ok) : Boolean(repoValidation?.ok);
  const errorText = kind === "folder" ? folderValidation?.error : repoValidation?.error;
  const slug = kind === "folder" ? folderValidation?.slug : repoValidation?.repo;
  const showInlineError = value.trim().length > 0 && !isValid;

  const handleSubmit = useCallback(async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const item =
        kind === "folder"
          ? await createFolderItemApi(projectSlug, value.trim())
          : await importRepoItemApi(projectSlug, kind, value.trim());
      onCreated(item);
    } catch (err) {
      setServerError(
        err instanceof ProjectsApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to create item",
      );
      setSubmitting(false);
    }
  }, [isValid, kind, onCreated, projectSlug, submitting, value]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="btn-press flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-60"
          aria-label="Back"
        >
          <FiArrowLeft size={13} />
        </button>
        <h3 className="text-[13px] font-semibold text-canvas-fg">{titleFor(kind)}</h3>
      </div>

      <label htmlFor="item-input" className="mt-3 block text-[11px] font-medium text-canvas-muted">
        {kind === "folder" ? "Folder name" : "Repo URL"}
      </label>
      <input
        ref={inputRef}
        id="item-input"
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (serverError) setServerError(null);
        }}
        disabled={submitting}
        placeholder={placeholderFor(kind)}
        className="mt-1 w-full rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 text-[13px] text-canvas-fg outline-none focus:border-canvas-fg disabled:opacity-60"
      />

      <div className="mt-1.5 min-h-4 text-[11px]">
        {showInlineError ? (
          <span className="text-red-500">{errorText}</span>
        ) : isValid && slug ? (
          <span className="text-canvas-muted">
            Folder will be: <span className="font-mono text-canvas-fg">{slug}</span>
          </span>
        ) : (
          <span className="text-canvas-muted">{hintFor(kind)}</span>
        )}
      </div>

      {serverError && (
        <p className="mt-2 rounded-md bg-red-500/10 px-3 py-2 text-[12px] text-red-500">
          {serverError}
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="btn-press rounded-lg px-3 py-1.5 text-[12px] text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!isValid || submitting}
          className="btn-press rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? submittingLabelFor(kind) : actionLabelFor(kind)}
        </button>
      </div>
    </form>
  );
}

function titleFor(kind: FormKind): string {
  if (kind === "folder") return "New folder";
  if (kind === "github") return "Import from GitHub";
  return "Import from Bitbucket";
}

function placeholderFor(kind: FormKind): string {
  if (kind === "folder") return "e.g. Notes";
  if (kind === "github") return "https://github.com/owner/repo";
  return "https://bitbucket.org/workspace/repo";
}

function hintFor(kind: FormKind): string {
  if (kind === "folder") return "Letters, numbers, spaces, hyphens — up to 64 characters.";
  return "Paste an https URL on the matching host.";
}

function actionLabelFor(kind: FormKind): string {
  return kind === "folder" ? "Create" : "Import";
}

function submittingLabelFor(kind: FormKind): string {
  return kind === "folder" ? "Creating…" : "Cloning…";
}
