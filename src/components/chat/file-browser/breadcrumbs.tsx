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

/**
 * Shared chip styling so every segment reads as a button even without a
 * hover state (mobile). Height 32 on touch devices, tighter on desktop.
 */
const SEG_CLS =
  "flex h-8 shrink-0 items-center gap-1 rounded-md bg-canvas-bg/60 px-2.5 text-[12px] font-medium text-canvas-muted " +
  "hover:bg-canvas-surface-hover hover:text-canvas-fg active:scale-[0.97] active:bg-canvas-surface-hover " +
  "transition-colors sm:h-6 sm:px-2 sm:text-[11px]";

export function Breadcrumbs({ path, onNavigate }: BreadcrumbsProps) {
  const segments = segmentsFor(path);
  return (
    <nav
      aria-label="File path"
      className="flex items-center gap-1 overflow-x-auto border-b border-canvas-border px-2 py-1.5 no-scrollbar"
    >
      <button
        type="button"
        onClick={() => onNavigate("~")}
        aria-label="Home directory"
        title="Go to home"
        className={SEG_CLS}
      >
        <FiHome size={12} />
        <span className="hidden sm:inline">~</span>
      </button>
      {segments.map((crumb, i) => {
        const isCurrent = i === segments.length - 1;
        return (
          <span key={crumb.path} className="flex shrink-0 items-center gap-1">
            <FiChevronRight size={11} className="shrink-0 text-canvas-muted/60" aria-hidden />
            <button
              type="button"
              onClick={() => onNavigate(crumb.path)}
              aria-current={isCurrent ? "page" : undefined}
              title={`Go to ${crumb.path}`}
              className={
                isCurrent ? SEG_CLS + " !bg-canvas-bg !text-canvas-fg font-semibold" : SEG_CLS
              }
            >
              {crumb.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
