"use client";

import { formatRelativeTime } from "@/lib/format-time";
import type { GitLogEntry } from "@/lib/git/types";

interface CommitListItemProps {
  entry: GitLogEntry;
}

export function CommitListItem({ entry }: CommitListItemProps) {
  const isMerge = entry.parents.length > 1;
  return (
    <div
      title={`${entry.sha}\n${entry.authorName} <${entry.authorEmail}>\n${new Date(entry.timestamp).toLocaleString()}`}
      className={`flex items-start gap-2 px-3 py-1.5 ${isMerge ? "opacity-70" : ""}`}
    >
      <span className="mt-0.5 shrink-0 font-mono text-[10px] text-canvas-muted">
        {entry.shortSha}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] text-canvas-fg">{entry.subject}</span>
        <span className="block truncate text-[10px] text-canvas-muted">
          {entry.authorName} · {entry.timestamp > 0 ? formatRelativeTime(entry.timestamp) : ""}
        </span>
      </span>
    </div>
  );
}
