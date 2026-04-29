"use client";

import { useCallback, useEffect, useState } from "react";
import { FiArrowLeft, FiFolder } from "react-icons/fi";
import { useUrlState } from "@/lib/use-url-state";
import { fetchProjects, type ProjectMeta } from "@/lib/projects-api";
import { ProjectsDashboard } from "./projects-dashboard";

interface ProjectsMainPaneProps {
  onOpenSessions?: () => void;
}

/**
 * Router for the main pane when `?view=projects`.
 *
 *   (no ?project)   → ProjectsDashboard (card grid + create flow)
 *   ?project=<slug> → ProjectDetail placeholder (future home for per-project features)
 */
export function ProjectsMainPane({ onOpenSessions }: ProjectsMainPaneProps) {
  const { params } = useUrlState();
  const slug = params.get("project");

  if (slug) {
    return <ProjectDetail slug={slug} onOpenSessions={onOpenSessions} />;
  }
  return <ProjectsDashboard onOpenSessions={onOpenSessions} />;
}

function ProjectDetail({ slug, onOpenSessions }: { slug: string; onOpenSessions?: () => void }) {
  const { setParam } = useUrlState();
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prop→state sync: reset loading/missing flags whenever slug changes
    setLoading(true);
    setMissing(false);
    fetchProjects()
      .then(({ projects }) => {
        if (cancelled) return;
        const match = projects.find((p) => p.slug === slug);
        if (!match) setMissing(true);
        else setProject(match);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleBack = useCallback(() => {
    setParam("project", null);
  }, [setParam]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas-bg">
      <header className="flex shrink-0 items-center gap-2 border-b border-canvas-border px-4 py-3">
        {onOpenSessions && (
          <button
            type="button"
            onClick={onOpenSessions}
            className="btn-press flex h-9 w-9 items-center justify-center rounded-lg text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg md:hidden"
            aria-label="Open sidebar"
          >
            <FiArrowLeft size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={handleBack}
          className="btn-press hidden h-9 w-9 items-center justify-center rounded-lg text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg md:flex"
          aria-label="Back to projects"
          title="Back to projects"
        >
          <FiArrowLeft size={16} />
        </button>
        <h1 className="line-clamp-1 text-[15px] font-semibold text-canvas-fg">
          {project?.displayName ?? slug}
        </h1>
        {project && (
          <span className="rounded-full bg-canvas-surface-hover px-2 py-0.5 font-mono text-[10px] text-canvas-muted">
            {project.slug}
          </span>
        )}
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        {missing ? (
          <div className="text-center">
            <p className="text-[14px] font-medium text-canvas-fg">Project not found</p>
            <p className="mt-1 text-[12px] text-canvas-muted">
              The folder for <span className="font-mono">{slug}</span> no longer exists.
            </p>
            <button
              type="button"
              onClick={handleBack}
              className="btn-press mt-4 rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
            >
              Back to projects
            </button>
          </div>
        ) : loading ? (
          <p className="text-[12px] text-canvas-muted">Loading project…</p>
        ) : (
          <div className="mx-auto flex max-w-md flex-col items-center text-center">
            <div
              className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ backgroundColor: "var(--canvas-surface-hover)" }}
            >
              <FiFolder size={24} className="text-canvas-muted" />
            </div>
            <h2 className="text-[15px] font-semibold text-canvas-fg">{project?.displayName}</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-canvas-muted">
              Per-project features are coming soon. For now, this folder lives at{" "}
              <span className="font-mono">~/projects/{slug}</span> on the device — drop files in
              from the file browser to seed the project.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
