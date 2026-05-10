"use client";

import { useCallback, useEffect, useState } from "react";
import { FiAlertTriangle, FiLoader } from "react-icons/fi";

import { authFetch } from "@/lib/auth";

import { MarkdownFileEditor } from "../markdown-file-editor";
import { SettingsSection } from "../settings-section";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

const MEMORY_NAME_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*\.md$/;
const MEMORY_NAME_HINT =
  "Lowercase letters, digits, '-' and '_'; ends with .md. Use '/' for subpaths.";

const PROJECT_TEMPLATE = `# Memory note

Notes saved here apply only to this project. The Claude Agent SDK also
reads and writes here automatically as you work.
`;

interface ProjectMeta {
  slug: string;
  displayName: string;
}

interface SettingsMemoryProjectPageProps {
  slug: string;
}

export function SettingsMemoryProjectPage({ slug }: SettingsMemoryProjectPageProps) {
  const [project, setProject] = useState<ProjectMeta | null | "missing">(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/projects/${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        setProject("missing");
        return;
      }
      if (!res.ok) throw new Error("fetch");
      const data = (await res.json()) as { project?: ProjectMeta };
      setProject(data.project ?? "missing");
    } catch {
      setProject("missing");
    }
  }, [slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (project === null) {
    return (
      <div className="flex items-center justify-center py-8 text-canvas-muted">
        <FiLoader size={14} className="animate-spin" />
      </div>
    );
  }

  if (project === "missing") {
    return (
      <SettingsSection title="Project not found" description={slug}>
        <p className="flex items-center gap-2 text-[12px] text-red-500">
          <FiAlertTriangle size={12} />
          No project with this slug exists.
        </p>
      </SettingsSection>
    );
  }

  return (
    <div className="space-y-4">
      <SettingsSection
        title={project.displayName}
        description="Memory files Claude reads and writes for this project"
      >
        <MarkdownFileEditor
          singular="Memory file"
          plural="Memory files"
          apiPath={`${BASE}/api/memory/projects/${encodeURIComponent(slug)}`}
          emptyHelp="No memory yet. Either Claude will populate it as you chat, or you can add notes manually here."
          newTemplate={PROJECT_TEMPLATE}
          nameRegex={MEMORY_NAME_RE}
          nameHint={MEMORY_NAME_HINT}
          namePlaceholder="notes.md"
        />
      </SettingsSection>
      <p className="px-1 text-[10px] leading-relaxed text-canvas-muted">
        Stored under{" "}
        <code className="rounded bg-canvas-surface px-1 py-0.5">
          ~/.claude/projects/&lt;sanitized-cwd&gt;/memory/
        </code>
        . Claude reads them at the start of every turn in this project&apos;s working directory.
      </p>
    </div>
  );
}
