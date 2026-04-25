"use client";

import { FiCheck } from "react-icons/fi";
import type { GitBranch } from "@/lib/git/types";

interface BranchListItemProps {
  branch: GitBranch;
  onClick: () => void;
}

export function BranchListItem({ branch, onClick }: BranchListItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={branch.upstream ? `Tracks ${branch.upstream}` : undefined}
      className="row-hover flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-canvas-surface-hover focus-visible:bg-canvas-surface-hover focus-visible:outline-none"
    >
      <span
        className={`mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center ${
          branch.current ? "text-accent" : "text-canvas-muted/40"
        }`}
        aria-hidden
      >
        {branch.current ? (
          <FiCheck size={11} />
        ) : (
          <span className="h-1 w-1 rounded-full bg-current" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[12px] ${
            branch.current ? "font-semibold text-canvas-fg" : "text-canvas-fg"
          }`}
        >
          {branch.name}
        </span>
        {branch.tipSubject && (
          <span className="block truncate text-[10px] text-canvas-muted">{branch.tipSubject}</span>
        )}
      </span>
      {branch.upstream && (
        <span className="shrink-0 truncate rounded border border-canvas-border bg-canvas-surface/60 px-1.5 py-0.5 text-[9px] text-canvas-muted">
          {branch.upstream}
        </span>
      )}
    </button>
  );
}
