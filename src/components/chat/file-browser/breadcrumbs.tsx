"use client";

import { FiChevronRight, FiHome } from "react-icons/fi";

interface BreadcrumbsProps {
  path: string;
  onNavigate: (path: string) => void;
}

/** Split a POSIX path into clickable segments. Empty segments collapsed. */
function segmentsFor(path: string): { label: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((part, i) => ({
    label: part,
    path: "/" + parts.slice(0, i + 1).join("/"),
  }));
}

export function Breadcrumbs({ path, onNavigate }: BreadcrumbsProps) {
  const segments = segmentsFor(path);
  return (
    <nav
      aria-label="File path"
      className="flex items-center gap-1 overflow-x-auto border-b border-canvas-border px-3 py-2 no-scrollbar"
    >
      <button
        type="button"
        onClick={() => onNavigate("~")}
        aria-label="Home directory"
        className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
      >
        <FiHome size={11} />
        <span className="hidden sm:inline">~</span>
      </button>
      {segments.map((crumb, i) => (
        <span key={crumb.path} className="flex items-center gap-1">
          <FiChevronRight size={10} className="text-canvas-muted/50" aria-hidden />
          <button
            type="button"
            onClick={() => onNavigate(crumb.path)}
            aria-current={i === segments.length - 1 ? "page" : undefined}
            className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] hover:bg-canvas-surface-hover hover:text-canvas-fg ${
              i === segments.length - 1 ? "text-canvas-fg" : "text-canvas-muted"
            }`}
          >
            {crumb.label}
          </button>
        </span>
      ))}
    </nav>
  );
}
