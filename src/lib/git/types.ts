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
