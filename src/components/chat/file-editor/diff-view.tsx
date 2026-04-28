"use client";

import { FiAlertTriangle, FiLoader, FiRefreshCw } from "react-icons/fi";
import { useGitDiff } from "@/lib/use-git-diff";
import type { DiffAgainst } from "@/lib/git/types";
import type { FileEntry } from "@/lib/types";
import { SyntaxCode } from "@/components/chat/previews/syntax-code";

interface DiffViewProps {
  file: FileEntry;
  against: DiffAgainst;
  /**
   * Bumped by the parent after a successful save so the diff cache
   * invalidates and the new working-tree state shows up.
   */
  refreshKey?: number;
}

const AGAINST_LABEL: Record<DiffAgainst, string> = {
  working: "working tree",
  head: "HEAD",
  staged: "the staged copy",
};

export function DiffView({ file, against, refreshKey = 0 }: DiffViewProps) {
  const { diff, tracked, isRepo, loading, error, reload } = useGitDiff(file.path, against);

  // Refire on refreshKey change (parent's signal that the file was saved).
  // We don't want a useEffect just for this — `reload` is stable thanks to
  // the hook's useCallback, but calling it during render is unsafe; defer
  // via a microtask so we don't flush state updates inside the render pass.
  if (refreshKey !== lastSeenKey.get(file.path)) {
    lastSeenKey.set(file.path, refreshKey);
    queueMicrotask(reload);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <FiLoader size={16} className="animate-spin text-canvas-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <FiAlertTriangle size={18} className="text-red-400" />
        <p className="max-w-[320px] text-[12px] text-red-400">{error}</p>
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

  if (!isRepo) {
    return (
      <p className="py-8 text-center text-[12px] text-canvas-muted">
        This file isn&apos;t inside a git repository.
      </p>
    );
  }

  if (!tracked) {
    return (
      <p className="py-8 text-center text-[12px] text-canvas-muted">
        File isn&apos;t tracked by git — nothing to diff.
      </p>
    );
  }

  if (!diff) {
    return (
      <p className="py-8 text-center text-[12px] text-canvas-muted">
        No changes vs {AGAINST_LABEL[against]}.
      </p>
    );
  }

  return (
    <div className="h-full overflow-auto p-2 text-[12px]">
      <SyntaxCode language="diff" code={diff} />
    </div>
  );
}

// Module-scoped tracker for the parent's refreshKey, keyed by file path.
// Used to detect a "save just happened" without paying for a useEffect.
const lastSeenKey = new Map<string, number>();
