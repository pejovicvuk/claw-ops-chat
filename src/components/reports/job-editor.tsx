"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FiX } from "react-icons/fi";
import {
  createJob,
  fetchCronPreview,
  fetchJob,
  fetchToolCatalog,
  updateJob,
  type ToolCatalogResponse,
} from "@/lib/reports-api";
import { serializeJobMarkdown } from "@/lib/reports/job-parser";
import type { ReportJob } from "@/lib/reports/types";
import { Z_INDEX } from "@/lib/z-index";

interface JobEditorProps {
  slug: string | null;
  onClose: () => void;
}

const DEFAULT_DRAFT: ReportJob = {
  id: "",
  slug: "",
  name: "",
  schedule: "0 6 * * *",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  enabled: true,
  version: 1,
  maxTurns: 40,
  maxDurationSec: 900,
  concurrency: "skip",
  allowedTools: ["Read", "Glob", "Grep", "Write", "WebSearch", "WebFetch"],
  allowedBashPrefixes: [],
  allowedMcpServers: [],
  outputDir: "",
  outputFilename: "{date}-{slug}.md",
  notifyOnComplete: true,
  notifyOnError: true,
  prompt: "",
};

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Drawer editor for a job definition. Creating a new job uses slug=null;
 * editing an existing one uses the slug. The form round-trips with
 * markdown via serializeJobMarkdown, and the save button POSTs or PUTs
 * as appropriate.
 */
export function JobEditor({ slug, onClose }: JobEditorProps) {
  const [draft, setDraft] = useState<ReportJob>(() => ({ ...DEFAULT_DRAFT }));
  // Unknown frontmatter from the editing path is preserved via the raw-
  // markdown round trip. We don't surface it in the form today, but a
  // future iteration can expose it as a read-only "extra keys" section.
  const [unknownFrontmatter] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(slug !== null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [catalog, setCatalog] = useState<ToolCatalogResponse | null>(null);
  const [cronPreview, setCronPreview] = useState<{
    valid: boolean;
    human?: string;
    nextRuns?: string[];
    error?: string;
  } | null>(null);

  // Load tool catalog once.
  useEffect(() => {
    fetchToolCatalog()
      .then(setCatalog)
      .catch(() => {});
  }, []);

  // Load existing job when editing.
  useEffect(() => {
    if (slug === null) {
      setLoading(false);
      return;
    }
    fetchJob(slug)
      .then(({ job }) => {
        setDraft(job);
        setLoading(false);
      })
      .catch((err) => {
        alert(`Failed to load job: ${(err as Error).message}`);
        onClose();
      });
  }, [slug, onClose]);

  // Live cron preview, debounced.
  useEffect(() => {
    const handle = setTimeout(() => {
      fetchCronPreview(draft.schedule, draft.timezone)
        .then(setCronPreview)
        .catch(() => setCronPreview({ valid: false, error: "Preview failed" }));
    }, 300);
    return () => clearTimeout(handle);
  }, [draft.schedule, draft.timezone]);

  // Auto-fill slug + outputDir from name when creating.
  const handleNameChange = useCallback(
    (name: string) => {
      setDraft((d) => {
        if (slug !== null) return { ...d, name };
        const nextSlug = slugify(name);
        return {
          ...d,
          name,
          id: nextSlug,
          slug: nextSlug,
          outputDir: nextSlug ? `/root/reports/${nextSlug}` : "",
        };
      });
    },
    [slug],
  );

  const toggleTool = useCallback((tool: string) => {
    setDraft((d) => {
      const has = d.allowedTools.includes(tool);
      return {
        ...d,
        allowedTools: has ? d.allowedTools.filter((t) => t !== tool) : [...d.allowedTools, tool],
      };
    });
  }, []);

  const toggleMcpServer = useCallback((name: string) => {
    setDraft((d) => {
      const has = d.allowedMcpServers.includes(name);
      const nextServers = has
        ? d.allowedMcpServers.filter((s) => s !== name)
        : [...d.allowedMcpServers, name];
      // When enabling a server, also add its wildcard to allowedTools.
      const wildcard = `mcp__${name}__*`;
      let nextTools = d.allowedTools;
      if (!has && !nextTools.includes(wildcard)) {
        nextTools = [...nextTools, wildcard];
      }
      if (has) {
        nextTools = nextTools.filter((t) => t !== wildcard);
      }
      return { ...d, allowedMcpServers: nextServers, allowedTools: nextTools };
    });
  }, []);

  const markdownPreview = useMemo(
    () => serializeJobMarkdown(draft, unknownFrontmatter),
    [draft, unknownFrontmatter],
  );

  const [showRaw, setShowRaw] = useState(false);
  const [rawBuffer, setRawBuffer] = useState("");

  const handleOpenRaw = useCallback(() => {
    setRawBuffer(markdownPreview);
    setShowRaw(true);
  }, [markdownPreview]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setErrors([]);
    try {
      const markdown = showRaw ? rawBuffer : markdownPreview;
      if (slug === null) {
        await createJob(markdown);
      } else {
        await updateJob(slug, markdown);
      }
      onClose();
    } catch (err) {
      // Parse validation errors from the API response if present.
      const message = err instanceof Error ? err.message : "Save failed";
      const jsonMatch = message.match(/\{.*\}/);
      if (jsonMatch) {
        try {
          const body = JSON.parse(jsonMatch[0]) as {
            errors?: Array<{ field: string; message: string }>;
          };
          if (body.errors) {
            setErrors(body.errors);
            setSaving(false);
            return;
          }
        } catch {
          /* fall through */
        }
      }
      alert(message);
    } finally {
      setSaving(false);
    }
  }, [markdownPreview, onClose, rawBuffer, showRaw, slug]);

  return (
    <div
      className="fixed inset-0 flex items-stretch justify-end bg-black/40 backdrop-blur-[2px]"
      style={{ zIndex: Z_INDEX.MODAL }}
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-2xl flex-col bg-canvas-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-canvas-border px-4 py-3">
          <h2 className="text-[15px] font-semibold">
            {slug === null ? "New Report Job" : `Edit: ${draft.name || draft.slug}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn-press flex h-8 w-8 items-center justify-center rounded-lg text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiX size={16} />
          </button>
        </header>

        {loading ? (
          <div className="flex-1 p-4">
            <div className="h-6 w-1/3 animate-pulse rounded bg-canvas-surface-hover" />
          </div>
        ) : showRaw ? (
          <RawEditor value={rawBuffer} onChange={setRawBuffer} onClose={() => setShowRaw(false)} />
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {errors.length > 0 && (
              <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-[12px] text-red-900">
                <p className="font-semibold">Please fix these errors:</p>
                <ul className="mt-1 list-disc pl-4">
                  {errors.map((e, i) => (
                    <li key={i}>
                      <span className="font-mono">{e.field}</span>: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Section label="Basics">
              <Field label="Name">
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Morning Digest"
                  className="w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 text-[13px]"
                />
                {draft.slug && (
                  <p className="mt-1 text-[11px] text-canvas-muted">
                    slug: <span className="font-mono">{draft.slug}</span>
                  </p>
                )}
              </Field>
            </Section>

            <Section label="Schedule">
              <Field label="Cron expression">
                <input
                  type="text"
                  value={draft.schedule}
                  onChange={(e) => setDraft({ ...draft, schedule: e.target.value })}
                  placeholder="0 6 * * *"
                  className="w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[13px]"
                />
                {cronPreview && (
                  <p
                    className="mt-1 text-[11px]"
                    style={{ color: cronPreview.valid ? "var(--canvas-muted)" : "#f87171" }}
                  >
                    {cronPreview.valid
                      ? `${cronPreview.human} — next: ${
                          cronPreview.nextRuns?.[0]
                            ? new Date(cronPreview.nextRuns[0]).toLocaleString()
                            : "?"
                        }`
                      : cronPreview.error}
                  </p>
                )}
              </Field>
              <Field label="Timezone">
                <input
                  type="text"
                  value={draft.timezone}
                  onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
                  placeholder="UTC"
                  className="w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 text-[13px]"
                />
              </Field>
              <Field label="Enabled">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                />
                <span className="ml-2 text-[12px] text-canvas-muted">
                  Paused jobs stay in the list but won&apos;t fire.
                </span>
              </Field>
            </Section>

            <Section label="Prompt">
              <textarea
                value={draft.prompt}
                onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
                rows={10}
                placeholder={
                  "Describe what Claude should do. Use {{outputPath}} to reference the output file."
                }
                className="w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px]"
              />
            </Section>

            <Section label="Output">
              <Field label="Output directory">
                <input
                  type="text"
                  value={draft.outputDir}
                  onChange={(e) => setDraft({ ...draft, outputDir: e.target.value })}
                  className="w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 text-[13px]"
                />
              </Field>
              <Field label="Filename pattern">
                <input
                  type="text"
                  value={draft.outputFilename}
                  onChange={(e) => setDraft({ ...draft, outputFilename: e.target.value })}
                  className="w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[13px]"
                />
                <p className="mt-1 text-[11px] text-canvas-muted">
                  Tokens: {"{date}"} {"{datetime}"} {"{slug}"} {"{runId}"}
                </p>
              </Field>
            </Section>

            <Section label="Tools">
              <p className="mb-2 text-[11px] text-canvas-muted">
                Only ticked tools are callable in this run — everything else is auto-denied. No
                permission prompts will fire.
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {(catalog?.builtins ?? []).map((tool) => (
                  <label
                    key={tool}
                    className="flex items-center gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-canvas-surface-hover"
                  >
                    <input
                      type="checkbox"
                      checked={draft.allowedTools.includes(tool)}
                      onChange={() => toggleTool(tool)}
                    />
                    <span className="font-mono">{tool}</span>
                  </label>
                ))}
              </div>
              {catalog?.mcpServers && catalog.mcpServers.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold text-canvas-muted">MCP servers</p>
                  <div className="mt-1 space-y-0.5">
                    {catalog.mcpServers.map((s) => (
                      <label
                        key={s.name}
                        className="flex items-center gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-canvas-surface-hover"
                      >
                        <input
                          type="checkbox"
                          checked={draft.allowedMcpServers.includes(s.name)}
                          onChange={() => toggleMcpServer(s.name)}
                        />
                        <span className="font-mono">{s.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            <Section label="Advanced">
              <Field label="Max turns">
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={draft.maxTurns}
                  onChange={(e) => setDraft({ ...draft, maxTurns: Number(e.target.value) || 40 })}
                  className="w-24 rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 text-[13px]"
                />
              </Field>
              <Field label="Max duration (seconds)">
                <input
                  type="number"
                  min={30}
                  max={86400}
                  value={draft.maxDurationSec}
                  onChange={(e) =>
                    setDraft({ ...draft, maxDurationSec: Number(e.target.value) || 900 })
                  }
                  className="w-24 rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 text-[13px]"
                />
              </Field>
              <button
                type="button"
                onClick={handleOpenRaw}
                className="mt-2 text-[12px] text-accent hover:underline"
              >
                Edit as markdown…
              </button>
            </Section>
          </div>
        )}

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-canvas-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-md px-3 py-1.5 text-[13px] text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !draft.name || !draft.slug}
            className="btn-press rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : slug === null ? "Create" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-canvas-muted">
        {label}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-canvas-fg">{label}</span>
      {children}
    </label>
  );
}

function RawEditor({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (next: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] text-canvas-muted">
          Raw markdown — YAML frontmatter + prompt body. Round-trips with the form.
        </p>
        <button type="button" onClick={onClose} className="text-[12px] text-accent hover:underline">
          Back to form
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-0 flex-1 w-full resize-none rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px]"
        spellCheck={false}
      />
    </div>
  );
}
