"use client";

import { FiFolder, FiTrash2 } from "react-icons/fi";
import { formatRelativeTime } from "@/lib/format-time";
import type { ProjectMeta } from "@/lib/projects-api";

interface ProjectCardProps {
  project: ProjectMeta;
  onOpen: () => void;
  onDelete: () => void;
}

export function ProjectCard({ project, onOpen, onDelete }: ProjectCardProps) {
  return (
    <article className="group relative rounded-xl border border-canvas-border bg-canvas-bg p-4 shadow-sm transition-colors hover:bg-canvas-surface-hover">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 text-left"
        aria-label={`Open project ${project.displayName}`}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: "var(--canvas-surface-hover)" }}
        >
          <FiFolder size={16} className="text-canvas-muted" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-1 text-[14px] font-semibold text-canvas-fg">
            {project.displayName}
          </h3>
          <p className="mt-1 line-clamp-1 text-[12px] text-canvas-muted">
            <span className="font-mono">{project.slug}</span>
            <span className="mx-1.5">·</span>
            <span>created {formatRelativeTime(project.createdAt)}</span>
            <span className="mx-1.5">·</span>
            <span>
              {project.itemCount} item{project.itemCount === 1 ? "" : "s"}
            </span>
          </p>
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="btn-press absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-canvas-muted opacity-0 transition-opacity hover:bg-canvas-bg hover:text-red-500 group-hover:opacity-100 focus:opacity-100"
        aria-label={`Delete project ${project.displayName}`}
        title="Delete project"
      >
        <FiTrash2 size={14} />
      </button>
    </article>
  );
}
