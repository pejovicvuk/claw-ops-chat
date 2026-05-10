"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FiChevronRight, FiDatabase, FiFolder, FiLoader } from "react-icons/fi";

import { authFetch } from "@/lib/auth";
import { useUrlState } from "@/lib/use-url-state";

import { MarkdownFileEditor } from "../markdown-file-editor";
import { SettingsSection } from "../settings-section";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

const MEMORY_NAME_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*\.md$/;
const MEMORY_NAME_HINT =
  "Lowercase letters, digits, '-' and '_'; ends with .md. Use '/' for subpaths (e.g. progress/today.md).";

const GLOBAL_TEMPLATE = `# Memory note

Anything written here is loaded into Claude's system prompt at the start
of every session, in every project. Keep it short and high-signal —
preferences, durable facts, decisions you don't want to repeat.
`;

interface ProjectMemoryRow {
  slug: string;
  displayName: string;
  createdAt: number;
  memoryBytes: number;
  memoryDir: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function SettingsMemoryPage() {
  const { setParam } = useUrlState();
  const [projects, setProjects] = useState<ProjectMemoryRow[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/memory/projects`);
      if (!res.ok) throw new Error("list");
      const data = (await res.json()) as { projects?: ProjectMemoryRow[] };
      setProjects(data.projects ?? []);
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const projectsContent = useMemo(() => {
    if (projects === null) {
      return (
        <div className="flex items-center justify-center py-6 text-canvas-muted">
          <FiLoader size={14} className="animate-spin" />
        </div>
      );
    }
    if (projects.length === 0) {
      return (
        <div className="rounded-xl border border-canvas-border bg-canvas-bg p-4 text-center">
          <p className="text-[12px] text-canvas-muted">
            No projects yet. Import a git repo from the dashboard to get a per-project memory.
          </p>
        </div>
      );
    }
    return (
      <ul className="space-y-2">
        {projects.map((project) => (
          <li key={project.slug}>
            <button
              type="button"
              onClick={() => setParam("settings", `memory/${project.slug}`)}
              className="flex w-full items-center gap-3 rounded-xl border border-canvas-border bg-canvas-bg px-4 py-3 text-left transition-colors hover:bg-canvas-surface-hover"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-canvas-surface text-canvas-fg">
                <FiFolder size={13} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-canvas-fg">
                  {project.displayName}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-canvas-muted">
                  {formatBytes(project.memoryBytes)} · {project.slug}
                </p>
              </div>
              <FiChevronRight size={13} className="shrink-0 text-canvas-muted" />
            </button>
          </li>
        ))}
      </ul>
    );
  }, [projects, setParam]);

  return (
    <div className="space-y-4">
      <SettingsSection title="How memory works" description="Persistent notes across chat sessions">
        <div className="space-y-2 text-[12px] leading-relaxed text-canvas-muted">
          <p className="flex items-start gap-2">
            <FiDatabase size={12} className="mt-0.5 shrink-0 text-canvas-muted" />
            <span>
              <strong className="text-canvas-fg">Global memory</strong> is loaded into Claude&apos;s
              system prompt at every turn, in every project. Edit it below.
            </span>
          </p>
          <p className="flex items-start gap-2">
            <FiFolder size={12} className="mt-0.5 shrink-0 text-canvas-muted" />
            <span>
              <strong className="text-canvas-fg">Per-project memory</strong> is managed by the
              Claude Agent SDK&apos;s auto-memory feature: Claude reads and writes notes scoped to a
              project&apos;s working directory. You can also browse and edit those files manually.
            </span>
          </p>
          <p className="text-[11px]">Caps: 100 KB per file, 10 MB per scope.</p>
        </div>
      </SettingsSection>

      <SettingsSection title="Global memory" description="Markdown files loaded into every chat">
        <MarkdownFileEditor
          singular="Memory file"
          plural="Memory files"
          apiPath={`${BASE}/api/memory/global`}
          emptyHelp="Global memory is empty. Add a file to share durable facts and preferences across every chat."
          newTemplate={GLOBAL_TEMPLATE}
          nameRegex={MEMORY_NAME_RE}
          nameHint={MEMORY_NAME_HINT}
          namePlaceholder="preferences.md"
        />
      </SettingsSection>

      <SettingsSection title="Per-project memory" description="One folder per imported project">
        {projectsContent}
      </SettingsSection>
    </div>
  );
}
