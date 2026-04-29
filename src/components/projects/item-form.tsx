"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiArrowLeft } from "react-icons/fi";
import { createFolderItemApi, importRepoItemApi, type ItemMeta } from "@/lib/items-api";
import { ProjectsApiError } from "@/lib/projects-api";
import { validateDisplayName, validateRepoUrl, type RepoKind } from "@/lib/projects/validation";
import { RepoPicker } from "./repo-picker";

export type FormKind = "folder" | RepoKind;

interface ItemFormProps {
  projectSlug: string;
  kind: FormKind;
  onCreated: (item: ItemMeta) => void;
  onBack: () => void;
}

/**
 * Item creation form. Three kinds:
 *
 *   folder  → free-form display name + slug preview
 *   github  → searchable repo picker on top + URL paste fallback below
 *   bitbucket → same shape as github
 *
 * Picker rows hand a canonical clone URL to the same import handler the
 * URL paste uses, so both paths share validation, error handling, and
 * the in-flight UI state.
 */
export function ItemForm({ projectSlug, kind, onCreated, onBack }: ItemFormProps) {
  if (kind === "folder") {
    return <FolderForm projectSlug={projectSlug} onCreated={onCreated} onBack={onBack} />;
  }
  return <RepoForm projectSlug={projectSlug} kind={kind} onCreated={onCreated} onBack={onBack} />;
}

/* ─────────────────── folder ─────────────────── */

function FolderForm({
  projectSlug,
  onCreated,
  onBack,
}: {
  projectSlug: string;
  onCreated: (item: ItemMeta) => void;
  onBack: () => void;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const validation = useMemo(() => validateDisplayName(value), [value]);
  const showInlineError = value.trim().length > 0 && !validation.ok;

  const handleSubmit = useCallback(async () => {
    if (!validation.ok || submitting) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const item = await createFolderItemApi(projectSlug, value.trim());
      onCreated(item);
    } catch (err) {
      setServerError(messageFor(err));
      setSubmitting(false);
    }
  }, [onCreated, projectSlug, submitting, validation.ok, value]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <FormHeader title="New folder" onBack={onBack} disabled={submitting} />

      <label htmlFor="item-input" className="mt-3 block text-[11px] font-medium text-canvas-muted">
        Folder name
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
        placeholder="e.g. Notes"
        className="mt-1 w-full rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 text-[13px] text-canvas-fg outline-none focus:border-canvas-fg disabled:opacity-60"
      />

      <div className="mt-1.5 min-h-4 text-[11px]">
        {showInlineError ? (
          <span className="text-red-500">{validation.error}</span>
        ) : validation.ok && validation.slug ? (
          <span className="text-canvas-muted">
            Folder will be: <span className="font-mono text-canvas-fg">{validation.slug}</span>
          </span>
        ) : (
          <span className="text-canvas-muted">
            Letters, numbers, spaces, hyphens — up to 64 characters.
          </span>
        )}
      </div>

      <ServerErrorBox message={serverError} />

      <FormFooter
        onBack={onBack}
        submitting={submitting}
        disabled={!validation.ok}
        submitLabel={submitting ? "Creating…" : "Create"}
      />
    </form>
  );
}

/* ─────────────────── github / bitbucket ─────────────────── */

function RepoForm({
  projectSlug,
  kind,
  onCreated,
  onBack,
}: {
  projectSlug: string;
  kind: RepoKind;
  onCreated: (item: ItemMeta) => void;
  onBack: () => void;
}) {
  const [url, setUrl] = useState("");
  const [submittingUrl, setSubmittingUrl] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const submitting = submittingUrl !== null;
  const urlValidation = useMemo(() => validateRepoUrl(kind, url), [kind, url]);
  const showInlineError = url.trim().length > 0 && !urlValidation.ok;

  const importByUrl = useCallback(
    async (cloneUrl: string) => {
      if (submittingUrl) return;
      setSubmittingUrl(cloneUrl);
      setServerError(null);
      try {
        const item = await importRepoItemApi(projectSlug, kind, cloneUrl);
        onCreated(item);
      } catch (err) {
        setServerError(messageFor(err));
        setSubmittingUrl(null);
      }
    },
    [kind, onCreated, projectSlug, submittingUrl],
  );

  const handlePastedSubmit = useCallback(() => {
    if (!urlValidation.ok || !urlValidation.normalizedUrl) return;
    importByUrl(urlValidation.normalizedUrl);
  }, [importByUrl, urlValidation.normalizedUrl, urlValidation.ok]);

  const handlePick = useCallback(
    (cloneUrl: string) => {
      importByUrl(cloneUrl);
    },
    [importByUrl],
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handlePastedSubmit();
      }}
    >
      <FormHeader
        title={kind === "github" ? "Import from GitHub" : "Import from Bitbucket"}
        onBack={onBack}
        disabled={submitting}
      />

      <div className="mt-3">
        <RepoPicker kind={kind} onPick={handlePick} importingUrl={submittingUrl} />
      </div>

      <div className="my-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-canvas-muted">
        <span className="h-px flex-1 bg-canvas-border" />
        <span>or paste a URL</span>
        <span className="h-px flex-1 bg-canvas-border" />
      </div>

      <input
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          if (serverError) setServerError(null);
        }}
        disabled={submitting}
        placeholder={
          kind === "github"
            ? "https://github.com/owner/repo"
            : "https://bitbucket.org/workspace/repo"
        }
        className="w-full rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 text-[13px] text-canvas-fg outline-none focus:border-canvas-fg disabled:opacity-60"
      />

      <div className="mt-1.5 min-h-4 text-[11px]">
        {showInlineError ? (
          <span className="text-red-500">{urlValidation.error}</span>
        ) : urlValidation.ok && urlValidation.repo ? (
          <span className="text-canvas-muted">
            Folder will be: <span className="font-mono text-canvas-fg">{urlValidation.repo}</span>
          </span>
        ) : (
          <span className="text-canvas-muted">Paste an https URL on the matching host.</span>
        )}
      </div>

      <ServerErrorBox message={serverError} />

      <FormFooter
        onBack={onBack}
        submitting={submitting}
        disabled={!urlValidation.ok}
        submitLabel={
          submittingUrl && submittingUrl === urlValidation.normalizedUrl ? "Cloning…" : "Import"
        }
      />
    </form>
  );
}

/* ─────────────────── shared ─────────────────── */

function FormHeader({
  title,
  onBack,
  disabled,
}: {
  title: string;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onBack}
        disabled={disabled}
        className="btn-press flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-60"
        aria-label="Back"
      >
        <FiArrowLeft size={13} />
      </button>
      <h3 className="text-[13px] font-semibold text-canvas-fg">{title}</h3>
    </div>
  );
}

function FormFooter({
  onBack,
  submitting,
  disabled,
  submitLabel,
}: {
  onBack: () => void;
  submitting: boolean;
  disabled: boolean;
  submitLabel: string;
}) {
  return (
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
        disabled={disabled || submitting}
        className="btn-press rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitLabel}
      </button>
    </div>
  );
}

function ServerErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mt-2 rounded-md bg-red-500/10 px-3 py-2 text-[12px] text-red-500">{message}</p>
  );
}

function messageFor(err: unknown): string {
  if (err instanceof ProjectsApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Failed to create item";
}
