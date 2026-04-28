"use client";

import { useState } from "react";
import { FiCheck, FiUsers } from "react-icons/fi";
import type { GitBranch } from "@/lib/git/types";
import type { SessionBranchSnapshot } from "@/lib/session-branches";
import { BranchCheckoutConfirm } from "./branch-checkout-confirm";

interface BranchListItemProps {
  branch: GitBranch;
  onClick: () => void;
  /** Sessions whose cwd resolves into this repo and currently sit on this branch. */
  sessionsOnBranch?: SessionBranchSnapshot[];
  /** True when the branch is the one the currently-selected chat is on. */
  isCurrentChatBranch?: boolean;
}

export function BranchListItem({
  branch,
  onClick,
  sessionsOnBranch = [],
  isCurrentChatBranch = false,
}: BranchListItemProps) {
  const [confirming, setConfirming] = useState(false);

  // Other-chat conflict: at least one session is on this branch but it
  // isn't the one currently open in the UI, AND it isn't the user's
  // current branch (where a checkout would be a no-op).
  const otherChatActive =
    sessionsOnBranch.length > 0 && !isCurrentChatBranch && !branch.current;

  const handleClick = () => {
    if (otherChatActive) {
      setConfirming(true);
      return;
    }
    onClick();
  };

  const chipClass = isCurrentChatBranch
    ? "bg-accent/15 text-accent"
    : "bg-canvas-bg/60 text-canvas-muted";

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
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
            <span className="block truncate text-[10px] text-canvas-muted">
              {branch.tipSubject}
            </span>
          )}
        </span>
        {sessionsOnBranch.length > 0 && (
          <span
            title={sessionsOnBranch.map((s) => s.display).join("\n")}
            className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[9px] ${chipClass}`}
          >
            <FiUsers size={9} />
            {sessionsOnBranch.length} chat{sessionsOnBranch.length === 1 ? "" : "s"}
          </span>
        )}
        {branch.upstream && (
          <span className="shrink-0 truncate rounded border border-canvas-border bg-canvas-surface/60 px-1.5 py-0.5 text-[9px] text-canvas-muted">
            {branch.upstream}
          </span>
        )}
      </button>
      {confirming && (
        <BranchCheckoutConfirm
          branchName={branch.name}
          sessions={sessionsOnBranch}
          onConfirm={() => {
            setConfirming(false);
            onClick();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
