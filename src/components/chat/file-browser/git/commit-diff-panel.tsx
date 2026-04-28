"use client";

import { FiAlertTriangle, FiGitMerge, FiLoader, FiRefreshCw } from "react-icons/fi";
import { useCommitDiff } from "@/lib/use-commit-diff";
import { SyntaxCode } from "@/components/chat/previews/syntax-code";

interface CommitDiffPanelProps {
  repoRoot: string;
  sha: string;
}

/**
 * Inline diff view for a single commit. Designed to live directly under
 * a CommitListItem when the user expands it. Mobile-first: capped height
 * with internal scroll so a 5000-line diff doesn't push the list off
 * screen, and tight typography so the diff stays readable on a phone.
 */
export function CommitDiffPanel({ repoRoot, sha }: CommitDiffPanelProps) {
  const { diff, stats, isMerge, found, isRepo, loading, error, reload } = useCommitDiff(
    repoRoot,
    sha,
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-canvas-muted">
        <FiLoader size={12} className="animate-spin" />
        Loading diff…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-1.5 px-3 py-3">
        <div className="flex items-center gap-1.5 text-[11px] text-red-400">
          <FiAlertTriangle size={11} />
          <span>{error}</span>
        </div>
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

  if (!isRepo || !found) {
    return (
      <p className="px-3 py-3 text-[11px] text-canvas-muted">Commit not found in this repo.</p>
    );
  }

  if (!diff) {
    return (
      <p className="px-3 py-3 text-[11px] text-canvas-muted">No file changes in this commit.</p>
    );
  }

  return (
    <div className="border-l-2 border-canvas-border bg-canvas-bg/40">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[10px] text-canvas-muted">
        <span>
          {stats.files} file{stats.files === 1 ? "" : "s"} changed
        </span>
        <span className="text-emerald-400">+{stats.insertions}</span>
        <span className="text-red-400">−{stats.deletions}</span>
        {isMerge && (
          <span
            title="Merge commit — diff shown vs first parent"
            className="ml-auto flex items-center gap-1 rounded bg-canvas-surface px-1.5 py-0.5 text-canvas-muted"
          >
            <FiGitMerge size={9} />
            vs first parent
          </span>
        )}
      </div>
      <div className="max-h-[60vh] overflow-auto px-2 pb-2 sm:max-h-[480px]">
        <SyntaxCode language="diff" code={diff} />
      </div>
    </div>
  );
}
