"use client";

import { FiChevronRight } from "react-icons/fi";
import { formatRelativeTime } from "@/lib/format-time";
import type { GitLogEntry } from "@/lib/git/types";
import { CommitDiffPanel } from "./commit-diff-panel";

interface CommitListItemProps {
  entry: GitLogEntry;
  /** True when this commit's diff panel is open below it. */
  expanded?: boolean;
  /** Toggle the expand/collapse for this commit. */
  onToggle?: () => void;
  /** Repo root path forwarded to the diff panel. */
  repoRoot?: string;
}

export function CommitListItem({
  entry,
  expanded = false,
  onToggle,
  repoRoot,
}: CommitListItemProps) {
  const isMerge = entry.parents.length > 1;
  const tooltip = `${entry.sha}\n${entry.authorName} <${entry.authorEmail}>\n${new Date(
    entry.timestamp,
  ).toLocaleString()}`;

  return (
    <div className={isMerge ? "opacity-90" : undefined}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        title={tooltip}
        className="row-hover flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-canvas-surface-hover focus-visible:bg-canvas-surface-hover focus-visible:outline-none"
      >
        <FiChevronRight
          size={11}
          aria-hidden
          className={`mt-1 shrink-0 text-canvas-muted/70 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
        <span className="mt-0.5 shrink-0 font-mono text-[10px] text-canvas-muted">
          {entry.shortSha}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] text-canvas-fg">{entry.subject}</span>
          <span className="block truncate text-[10px] text-canvas-muted">
            {entry.authorName} · {entry.timestamp > 0 ? formatRelativeTime(entry.timestamp) : ""}
          </span>
        </span>
      </button>
      {expanded && repoRoot && <CommitDiffPanel repoRoot={repoRoot} sha={entry.sha} />}
    </div>
  );
}
