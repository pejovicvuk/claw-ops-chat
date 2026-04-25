"use client";

import { FiAlertTriangle, FiRefreshCw } from "react-icons/fi";
import { useGitBranches } from "@/lib/use-git-branches";
import { BranchListItem } from "./branch-list-item";

interface BranchListProps {
  repoRoot: string;
  onSelectBranch: (name: string) => void;
}

export function BranchList({ repoRoot, onSelectBranch }: BranchListProps) {
  const { branches, loading, error, reload } = useGitBranches(repoRoot, true);

  if (loading && branches.length === 0) {
    return (
      <div className="space-y-1.5 p-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-7 animate-pulse rounded-md bg-canvas-surface"
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

  if (branches.length === 0) {
    return <p className="py-8 text-center text-[12px] text-canvas-muted">No local branches</p>;
  }

  return (
    <div role="list" aria-label="Branches">
      {branches.map((b) => (
        <div key={b.name} role="listitem">
          <BranchListItem branch={b} onClick={() => onSelectBranch(b.name)} />
        </div>
      ))}
    </div>
  );
}
