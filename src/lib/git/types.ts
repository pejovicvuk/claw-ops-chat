export type GitFileStatus =
  | "modified"
  | "untracked"
  | "staged"
  | "deleted"
  | "renamed"
  | "conflicted";

export interface GitStatusFile {
  /** Absolute path on disk; matches `FileEntry.path` for direct lookup. */
  path: string;
  /** Index (staged) status, null if file has no staged change. */
  index: GitFileStatus | null;
  /** Worktree (unstaged) status, null if file has no unstaged change. */
  worktree: GitFileStatus | null;
}

export interface GitStatusResponse {
  isRepo: boolean;
  /** Realpath-resolved repo root, or null when isRepo is false. */
  repoRoot: string | null;
  /** Current branch name, or null on detached HEAD. */
  branch: string | null;
  /** Short SHA when HEAD is detached. */
  detachedHead: string | null;
  /** Commits ahead of upstream; null when no upstream is tracked. */
  ahead: number | null;
  behind: number | null;
  files: GitStatusFile[];
}

export interface GitBranch {
  name: string;
  current: boolean;
  upstream: string | null;
  /** Short SHA of the branch tip. */
  sha: string;
  /** Subject line of the tip commit (display only). */
  tipSubject: string;
}

export interface GitBranchesResponse {
  isRepo: boolean;
  branches: GitBranch[];
}

export interface GitLogEntry {
  sha: string;
  shortSha: string;
  authorName: string;
  authorEmail: string;
  /** Author date in ms since epoch. */
  timestamp: number;
  subject: string;
  /** Parent SHAs — used by the UI to dim merge commits. */
  parents: string[];
}

export interface GitLogResponse {
  isRepo: boolean;
  branch: string | null;
  entries: GitLogEntry[];
}

/** Which side of git history to compare the working tree against. */
export type DiffAgainst = "working" | "head" | "staged";

export interface GitDiffResponse {
  isRepo: boolean;
  /** False when the file isn't tracked by git (or doesn't exist). */
  tracked: boolean;
  /** Unified diff text. Empty string when there's nothing to show. */
  diff: string;
  /** Set when the diff was capped or generation failed in a recoverable way. */
  error?: string;
}

export interface GitCommitDiffStats {
  /** Number of files touched by the commit. */
  files: number;
  /** Lines added across all files. */
  insertions: number;
  /** Lines removed across all files. */
  deletions: number;
}

export interface GitCommitDiffResponse {
  isRepo: boolean;
  /** False when the SHA doesn't resolve in this repo. */
  found: boolean;
  /** Whether the commit has 2+ parents. UI may show a hint that diff is vs first parent. */
  isMerge: boolean;
  stats: GitCommitDiffStats;
  /** Unified diff text. Empty when nothing changed (rare) or when capped. */
  diff: string;
  /** Set when the diff was capped or generation failed in a recoverable way. */
  error?: string;
}
