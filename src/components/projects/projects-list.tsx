"use client";

import { FiFolder } from "react-icons/fi";
import { formatRelativeTime } from "@/lib/format-time";
import type { ProjectMeta } from "@/lib/projects-api";

interface ProjectsListProps {
  projects: ProjectMeta[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  loading: boolean;
}

/**
 * Sidebar list for the Projects mode. Same row chrome as ReportsList /
 * SessionList so switching between tabs feels consistent.
 */
export function ProjectsList({ projects, selectedSlug, onSelect, loading }: ProjectsListProps) {
  if (loading && projects.length === 0) {
    return (
      <div className="space-y-1.5 px-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-12 rounded-lg bg-canvas-surface-hover/50 animate-pulse"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-[12px] text-canvas-muted">No projects yet</p>
        <p className="mt-1.5 px-6 text-[11px] leading-relaxed text-canvas-muted">
          Click the + above to create your first project.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 px-2">
      {projects.map((project) => (
        <Row
          key={project.slug}
          project={project}
          selected={project.slug === selectedSlug}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function Row({
  project,
  selected,
  onSelect,
}: {
  project: ProjectMeta;
  selected: boolean;
  onSelect: (slug: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(project.slug)}
      className={`row-hover focus-ring flex w-full items-start gap-2 rounded-lg pl-2.5 pr-3 py-2 text-left transition-colors ${
        selected
          ? "bg-canvas-surface-hover text-canvas-fg"
          : "text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
      }`}
      style={{
        borderLeftWidth: 4,
        borderLeftStyle: "solid",
        borderLeftColor: selected ? "var(--accent)" : "transparent",
      }}
      title={project.displayName}
    >
      <FiFolder size={12} className="mt-1 shrink-0 text-canvas-muted" />
      <div className="min-w-0 flex-1">
        <p className={`line-clamp-1 text-[13px] ${selected ? "font-medium text-canvas-fg" : ""}`}>
          {project.displayName}
        </p>
        <p className="mt-0.5 text-[10px]">
          {formatRelativeTime(project.createdAt)}
          {project.itemCount > 0 &&
            ` · ${project.itemCount} item${project.itemCount === 1 ? "" : "s"}`}
        </p>
      </div>
    </button>
  );
}
