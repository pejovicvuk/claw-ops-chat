"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { FiChevronRight } from "react-icons/fi";

interface CollapsibleBlockProps {
  title: string;
  description?: string;
  /** Right-aligned adornment in the header (e.g., status badge, metric). */
  rightAdornment?: ReactNode;
  /** Open by default? */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Collapsible section using the CSS-grid 0fr→1fr trick borrowed from the
 * FE server-dashboard. Smoothly animates content height without manual
 * measurement; works at any content size.
 */
export function CollapsibleBlock({
  title,
  description,
  rightAdornment,
  defaultOpen = true,
  children,
}: CollapsibleBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-canvas-border bg-canvas-bg">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-t-xl px-4 py-3 text-left transition-colors hover:bg-canvas-surface-hover"
      >
        <FiChevronRight
          size={13}
          className={`shrink-0 text-canvas-muted transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-canvas-fg">{title}</p>
          {description ? (
            <p className="mt-0.5 truncate text-[11px] text-canvas-muted">{description}</p>
          ) : null}
        </div>
        {rightAdornment ? <div className="shrink-0">{rightAdornment}</div> : null}
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className={`px-4 pb-4 pt-1 ${open ? "" : "pointer-events-none"}`}>{children}</div>
        </div>
      </div>
    </div>
  );
}
