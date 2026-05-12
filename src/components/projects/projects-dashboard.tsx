"use client";

import { useCallback } from "react";
import { FiArrowLeft, FiPlus, FiRefreshCw } from "react-icons/fi";
import { useUrlState } from "@/lib/use-url-state";
import { useProjects } from "@/lib/use-projects";
import { useExitAnimation } from "@/lib/use-exit-animation";
import { deleteProjectApi, type ProjectMeta } from "@/lib/projects-api";
import { ProjectCard } from "./project-card";
import { ProjectsEmptyState } from "./projects-empty-state";
import { NewProjectModal } from "./new-project-modal";

interface ProjectsDashboardProps {
  onOpenSessions?: () => void;
}

/**
 * Top-level Projects dashboard — header chrome + card grid + empty state +
 * create modal. Mirrors `ReportsDashboard` so navigation between the two
 * feels coherent.
 */
export function ProjectsDashboard({ onOpenSessions }: ProjectsDashboardProps) {
  const { params, setParam } = useUrlState();
  const { projects, loading, refresh } = useProjects();
  const isNew = params.get("newProject") === "1";
  const { mounted: newModalMounted, state: newModalAnim } = useExitAnimation(isNew, 200);

  const closeModal = useCallback(() => {
    setParam("newProject", null);
  }, [setParam]);

  const openModal = useCallback(() => {
    setParam("newProject", "1");
  }, [setParam]);

  const handleCreated = useCallback(
    (project: ProjectMeta) => {
      closeModal();
      refresh();
      setParam("project", project.slug);
    },
    [closeModal, refresh, setParam],
  );

  const handleOpenProject = useCallback(
    (slug: string) => {
      setParam("project", slug);
    },
    [setParam],
  );

  const handleDelete = useCallback(
    async (project: ProjectMeta) => {
      if (
        !confirm(
          `Delete project "${project.displayName}"? The folder and its contents will be removed.`,
        )
      ) {
        return;
      }
      try {
        await deleteProjectApi(project.slug);
        refresh();
      } catch (err) {
        alert(`Failed to delete: ${(err as Error).message}`);
      }
    },
    [refresh],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas-bg">
      <header className="pt-safe-top flex shrink-0 items-center justify-between border-b border-canvas-border px-4 pb-3">
        <div className="flex items-center gap-2">
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
          <h1 className="text-[15px] font-semibold text-canvas-fg">Projects</h1>
          {projects.length > 0 && (
            <span className="rounded-full bg-canvas-surface-hover px-2 py-0.5 text-[10px] font-medium text-canvas-muted">
              {projects.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={refresh}
            className="btn-press flex h-9 w-9 items-center justify-center rounded-lg text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
            aria-label="Refresh"
          >
            <FiRefreshCw size={14} />
          </button>
          <button
            type="button"
            onClick={openModal}
            className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
          >
            <FiPlus size={14} />
            New Project
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && projects.length === 0 && (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-[76px] rounded-xl bg-canvas-surface-hover/50 animate-pulse"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        )}
        {!loading && projects.length === 0 && <ProjectsEmptyState onCreate={openModal} />}
        {projects.length > 0 && (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {projects.map((project) => (
              <ProjectCard
                key={project.slug}
                project={project}
                onOpen={() => handleOpenProject(project.slug)}
                onDelete={() => handleDelete(project)}
              />
            ))}
          </div>
        )}
      </div>

      {newModalMounted && (
        <NewProjectModal
          onClose={closeModal}
          onCreated={handleCreated}
          animationState={newModalAnim}
        />
      )}
    </div>
  );
}
