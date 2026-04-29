"use client";

import { FiChevronRight, FiHome, FiLock } from "react-icons/fi";
import { isInside } from "@/lib/canvas/path-scope";

interface BreadcrumbsProps {
  path: string;
  onNavigate: (path: string) => void;
  /**
   * When set, the breadcrumb is clipped: segments above `rootPath`
   * are hidden, the "~" home chip is replaced with a lock + the root's
   * leaf name, and clicking that chip navigates to `rootPath` (not home).
   * The file browser also enforces the boundary in `navigateTo`, so the
   * breadcrumb is the visual half of the same rule.
   */
  rootPath?: string | null;
}

/** Split a POSIX path into clickable segments. Empty segments collapsed. */
function segmentsFor(path: string): { label: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((part, i) => ({
    label: part,
    path: "/" + parts.slice(0, i + 1).join("/"),
  }));
}

/** Last segment of a POSIX path, or "/" if there's nothing below root. */
function leafOf(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts.length === 0 ? "/" : parts[parts.length - 1];
}

const SEG_CLS =
  "flex h-8 shrink-0 items-center gap-1 rounded-md bg-canvas-bg/60 px-2.5 text-[12px] font-medium text-canvas-muted " +
  "hover:bg-canvas-surface-hover hover:text-canvas-fg active:scale-[0.97] active:bg-canvas-surface-hover " +
  "transition-colors sm:h-6 sm:px-2 sm:text-[11px]";

export function Breadcrumbs({ path, onNavigate, rootPath }: BreadcrumbsProps) {
  const allSegments = segmentsFor(path);
  const segments = rootPath
    ? allSegments.filter((s) => isInside(rootPath, s.path) && s.path !== rootPath)
    : allSegments;
  const atRoot = rootPath ? path === rootPath : false;

  return (
    <nav
      aria-label="File path"
      className="flex items-center gap-1 overflow-x-auto border-b border-canvas-border px-2 py-1.5 no-scrollbar"
    >
      {rootPath ? (
        <button
          type="button"
          onClick={() => onNavigate(rootPath)}
          aria-label="Item root"
          title={`Locked to ${rootPath}`}
          className={atRoot ? SEG_CLS + " !bg-canvas-bg !text-canvas-fg font-semibold" : SEG_CLS}
        >
          <FiLock size={11} />
          <span className="line-clamp-1 max-w-[160px]">{leafOf(rootPath)}</span>
        </button>
      ) : (
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
      )}
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
