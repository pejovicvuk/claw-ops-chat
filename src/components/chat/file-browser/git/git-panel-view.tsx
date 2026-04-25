"use client";

import { useCallback, useState } from "react";
import { FiArrowLeft } from "react-icons/fi";
import type { GitStatusResult } from "@/lib/use-git-status";
import { BranchList } from "./branch-list";
import { CommitList } from "./commit-list";

interface GitPanelViewProps {
  git: GitStatusResult;
  repoRoot: string;
}

type Tab = "branches" | "commits";

export function GitPanelView({ git, repoRoot }: GitPanelViewProps) {
  const [tab, setTab] = useState<Tab>("branches");
  const [activeBranch, setActiveBranch] = useState<string | null>(null);

  const handleSelectBranch = useCallback((name: string) => {
    setActiveBranch(name);
    setTab("commits");
  }, []);

  const branchLabel = activeBranch ?? git.branch ?? git.detachedHead ?? "HEAD";
  const aheadBehind =
    git.ahead !== null && git.behind !== null ? ` · ahead ${git.ahead} / behind ${git.behind}` : "";

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-canvas-border px-3 py-2">
        <p className="truncate text-[10px] text-canvas-muted">
          <span className="text-canvas-fg">{repoRoot}</span>
          {aheadBehind}
        </p>
      </div>

      <div className="flex shrink-0 border-b border-canvas-border">
        <TabButton active={tab === "branches"} onClick={() => setTab("branches")}>
          Branches
        </TabButton>
        <TabButton active={tab === "commits"} onClick={() => setTab("commits")}>
          Commits
          <span className="ml-1 truncate text-[10px] text-canvas-muted">· {branchLabel}</span>
        </TabButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "branches" ? (
          <BranchList repoRoot={repoRoot} onSelectBranch={handleSelectBranch} />
        ) : (
          <>
            {activeBranch && activeBranch !== git.branch && (
              <button
                type="button"
                onClick={() => setTab("branches")}
                className="flex w-full items-center gap-1 border-b border-canvas-border px-3 py-1.5 text-[10px] text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
              >
                <FiArrowLeft size={10} />
                Back to branches
              </button>
            )}
            <CommitList repoRoot={repoRoot} branch={activeBranch} />
          </>
        )}
      </div>
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-w-0 flex-1 items-center justify-center gap-1 px-2 py-2 text-[11px] transition-colors ${
        active
          ? "border-b-2 border-accent text-canvas-fg"
          : "border-b-2 border-transparent text-canvas-muted hover:text-canvas-fg"
      }`}
    >
      {children}
    </button>
  );
}
