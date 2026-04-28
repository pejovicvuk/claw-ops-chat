"use client";

import { useCallback, useState } from "react";
import { FiAlertTriangle, FiRefreshCw } from "react-icons/fi";
import { List, type RowComponentProps } from "react-window";
import { useGitLog } from "@/lib/use-git-log";
import { CommitListItem } from "./commit-list-item";

const VIRTUALIZE_THRESHOLD = 500;
const ROW_HEIGHT = 44;
const COMMIT_LIMIT = 100;

interface CommitListProps {
  repoRoot: string;
  branch: string | null;
}

export function CommitList({ repoRoot, branch }: CommitListProps) {
  const { entries, loading, error, reload } = useGitLog(repoRoot, branch, true, COMMIT_LIMIT);
  // Single-open expansion: clicking a commit row reveals its diff and
  // closes any other open commit. Mobile users on small screens never
  // have to dismiss two panels at once.
  const [expandedSha, setExpandedSha] = useState<string | null>(null);
  const handleToggle = useCallback((sha: string) => {
    setExpandedSha((prev) => (prev === sha ? null : sha));
  }, []);

  if (loading && entries.length === 0) {
    return (
      <div className="space-y-1.5 p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-10 animate-pulse rounded-md bg-canvas-surface"
            style={{ animationDelay: `${i * 60}ms` }}
            aria-hidden
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8">
        <FiAlertTriangle size={18} className="text-red-400" />
        <p className="text-center text-[12px] text-red-400">{error}</p>
        <button
          type="button"
          onClick={() => reload()}
          className="flex items-center gap-1 text-[11px] text-blue-400 hover:underline"
        >
          <FiRefreshCw size={10} />
          Retry
        </button>
      </div>
    );
  }

  if (entries.length === 0) {
    return <p className="py-8 text-center text-[12px] text-canvas-muted">No commits</p>;
  }

  // react-window assumes a fixed rowHeight, which breaks the moment one
  // row expands to show its diff. We bypass virtualization whenever any
  // commit is expanded. With COMMIT_LIMIT=100 this never matters today,
  // but the guard keeps things correct if the limit ever rises.
  if (entries.length >= VIRTUALIZE_THRESHOLD && expandedSha === null) {
    const Row = ({ index, style }: RowComponentProps<Record<string, never>>) => {
      const entry = entries[index];
      if (!entry) return null;
      return (
        <div style={style}>
          <CommitListItem
            entry={entry}
            expanded={false}
            onToggle={() => handleToggle(entry.sha)}
            repoRoot={repoRoot}
          />
        </div>
      );
    };
    return (
      <List
        rowCount={entries.length}
        rowHeight={ROW_HEIGHT}
        rowComponent={Row}
        rowProps={{}}
        overscanCount={8}
        defaultHeight={600}
        className="!h-full"
      />
    );
  }

  return (
    <div role="list" aria-label="Commits">
      {entries.map((entry) => (
        <div key={entry.sha} role="listitem">
          <CommitListItem
            entry={entry}
            expanded={entry.sha === expandedSha}
            onToggle={() => handleToggle(entry.sha)}
            repoRoot={repoRoot}
          />
        </div>
      ))}
    </div>
  );
}
