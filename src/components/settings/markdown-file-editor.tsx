"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiAlertTriangle,
  FiArrowLeft,
  FiCheck,
  FiEdit3,
  FiFileText,
  FiLoader,
  FiPlus,
  FiTrash2,
} from "react-icons/fi";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

export interface MarkdownItem {
  name: string;
  preview: string;
  size: number;
  updatedAt: number;
  description?: string;
}

interface MarkdownFileRecord {
  name: string;
  content: string;
  updatedAt: number;
}

/**
 * Default name validator: the slug shape used by rules/skills/subagents.
 * Memory files override this to allow slashes and a `.md` suffix.
 */
const DEFAULT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DEFAULT_NAME_HINT = "Use lowercase letters, digits, or dashes (up to 64 chars).";

export interface MarkdownFileEditorProps {
  /** Settings page label in the UI — e.g. "Rule", "Skill", "Subagent". */
  singular: string;
  /** Plural form for empty states + list header. */
  plural: string;
  /** API path segment under /api/agent-config/<endpoint>. Ignored when `apiPath` is set. */
  endpoint?: "rules" | "skills" | "subagents";
  /**
   * Full API path under the app's base path, e.g. `/api/memory/global`.
   * When set, takes precedence over `endpoint`. Lets the editor drive
   * any CRUD endpoint that mirrors the agent-config conventions.
   */
  apiPath?: string;
  /** Text shown on the empty-list card. */
  emptyHelp: string;
  /** Template seeded into the textarea when creating a new item. */
  newTemplate: string;
  /**
   * Validator for the `name` input on new items. Defaults to the slug
   * shape used by rules/skills/subagents.
   */
  nameRegex?: RegExp;
  /** Help text shown when `nameRegex` rejects the typed name. */
  nameHint?: string;
  /** Placeholder text for the name input. */
  namePlaceholder?: string;
}

type Mode =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "edit"; name: string; initialContent: string };

/**
 * List-with-inline-editor component powering /agent/rules, /agent/skills,
 * and /agent/subagents. Callers just pass an API endpoint and copy.
 */
export function MarkdownFileEditor({
  singular,
  plural,
  endpoint,
  apiPath,
  emptyHelp,
  newTemplate,
  nameRegex = DEFAULT_NAME_RE,
  nameHint = DEFAULT_NAME_HINT,
  namePlaceholder = "my-rule",
}: MarkdownFileEditorProps) {
  const [items, setItems] = useState<MarkdownItem[] | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!apiPath && !endpoint) {
    throw new Error("MarkdownFileEditor requires either apiPath or endpoint");
  }
  const apiRoot = apiPath ?? `${BASE}/api/agent-config/${endpoint}`;

  /**
   * Encode each path segment but preserve `/` separators so memory files
   * with subpaths (e.g. `progress/today.md`) hit the right catch-all
   * route. For the existing slug-style names this is a no-op.
   */
  const encodePath = (name: string): string => name.split("/").map(encodeURIComponent).join("/");

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(apiRoot);
      if (!res.ok) throw new Error("list");
      const data = (await res.json()) as { items?: MarkdownItem[] };
      setItems(data.items ?? []);
    } catch {
      setItems([]);
    }
  }, [apiRoot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openEdit = useCallback(
    async (name: string) => {
      setErr(null);
      setMode({ kind: "edit", name, initialContent: "" });
      try {
        const res = await authFetch(`${apiRoot}/${encodePath(name)}`);
        if (!res.ok) throw new Error("read");
        const data = (await res.json()) as MarkdownFileRecord;
        setMode({ kind: "edit", name, initialContent: data.content });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to open");
        setMode({ kind: "list" });
      }
    },
    [apiRoot],
  );

  const remove = useCallback(
    async (name: string) => {
      setBusy(true);
      setErr(null);
      try {
        const res = await authFetch(`${apiRoot}/${encodePath(name)}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("delete");
        await refresh();
        setMode({ kind: "list" });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to delete");
      } finally {
        setBusy(false);
      }
    },
    [apiRoot, refresh],
  );

  const save = useCallback(
    async (opts: { name: string; content: string; isNew: boolean }) => {
      setBusy(true);
      setErr(null);
      try {
        const url = opts.isNew ? apiRoot : `${apiRoot}/${encodePath(opts.name)}`;
        const method = opts.isNew ? "POST" : "PUT";
        const body = opts.isNew
          ? { name: opts.name, content: opts.content }
          : { content: opts.content };
        const res = await authFetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(payload.error || `Save failed (${res.status})`);
        }
        await refresh();
        setMode({ kind: "list" });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to save");
      } finally {
        setBusy(false);
      }
    },
    [apiRoot, refresh],
  );

  if (mode.kind === "new") {
    return (
      <EditorView
        singular={singular}
        isNew
        initialName=""
        initialContent={newTemplate}
        err={err}
        busy={busy}
        nameRegex={nameRegex}
        nameHint={nameHint}
        namePlaceholder={namePlaceholder}
        onCancel={() => {
          setErr(null);
          setMode({ kind: "list" });
        }}
        onSave={save}
      />
    );
  }

  if (mode.kind === "edit") {
    return (
      <EditorView
        singular={singular}
        isNew={false}
        initialName={mode.name}
        initialContent={mode.initialContent}
        err={err}
        busy={busy}
        nameRegex={nameRegex}
        nameHint={nameHint}
        namePlaceholder={namePlaceholder}
        onCancel={() => {
          setErr(null);
          setMode({ kind: "list" });
        }}
        onSave={save}
        onDelete={() => remove(mode.name)}
      />
    );
  }

  if (items === null) {
    return (
      <div className="flex items-center justify-center py-8 text-canvas-muted">
        <FiLoader size={14} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {err && (
        <p className="flex items-center gap-1 text-[11px] text-red-500">
          <FiAlertTriangle size={10} />
          {err}
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          setErr(null);
          setMode({ kind: "new" });
        }}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90"
      >
        <FiPlus size={11} />
        New {singular.toLowerCase()}
      </button>

      {items.length === 0 ? (
        <div className="rounded-xl border border-canvas-border bg-canvas-surface p-6 text-center">
          <p className="text-[13px] font-medium text-canvas-fg">No {plural.toLowerCase()} yet</p>
          <p className="mt-1 text-[11px] leading-relaxed text-canvas-muted">{emptyHelp}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.name}>
              <button
                type="button"
                onClick={() => openEdit(item.name)}
                className="flex w-full items-start gap-3 rounded-xl border border-canvas-border bg-canvas-bg px-4 py-3 text-left transition-colors hover:bg-canvas-surface-hover"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-canvas-surface text-canvas-fg">
                  <FiFileText size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[12px] font-medium text-canvas-fg">
                    {item.name}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-canvas-muted">
                    {item.description || item.preview || "(empty)"}
                  </p>
                </div>
                <FiEdit3 size={12} className="mt-1 shrink-0 text-canvas-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface EditorViewProps {
  singular: string;
  isNew: boolean;
  initialName: string;
  initialContent: string;
  err: string | null;
  busy: boolean;
  nameRegex: RegExp;
  nameHint: string;
  namePlaceholder: string;
  onCancel: () => void;
  onSave: (opts: { name: string; content: string; isNew: boolean }) => void;
  onDelete?: () => void;
}

function EditorView({
  singular,
  isNew,
  initialName,
  initialContent,
  err,
  busy,
  nameRegex,
  nameHint,
  namePlaceholder,
  onCancel,
  onSave,
  onDelete,
}: EditorViewProps) {
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState(initialContent);

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  const nameValid = useMemo(() => nameRegex.test(name), [name, nameRegex]);
  const canSave = nameValid && content.length > 0 && !busy;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex items-center gap-1.5 text-[11px] text-canvas-muted transition-colors hover:text-canvas-fg"
      >
        <FiArrowLeft size={11} />
        Back to list
      </button>

      <div className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] text-canvas-muted">Name</label>
            {isNew ? (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                placeholder={namePlaceholder}
                className="w-full rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
            ) : (
              <p className="rounded-lg bg-canvas-bg px-3 py-2 font-mono text-[12px] text-canvas-fg">
                {name}
              </p>
            )}
            {isNew && name.length > 0 && !nameValid && (
              <p className="mt-1 text-[10px] text-red-500">{nameHint}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-canvas-muted">Content (markdown)</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[280px] w-full resize-y rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px] leading-relaxed text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
              rows={14}
              spellCheck={false}
            />
          </div>

          {err && (
            <p className="flex items-center gap-1 text-[11px] text-red-500">
              <FiAlertTriangle size={10} />
              {err}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onSave({ name, content, isNew })}
              disabled={!canSave}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
            >
              {busy ? (
                <>
                  <FiLoader size={11} className="animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <FiCheck size={11} />
                  {isNew ? `Create ${singular.toLowerCase()}` : "Save"}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-40"
            >
              Cancel
            </button>
            {!isNew && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/15 disabled:opacity-40"
              >
                <FiTrash2 size={11} />
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
