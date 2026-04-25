import { posix } from "path";
import type { GitFileStatus, GitStatusFile } from "./types";

/**
 * Collapse a file's index + worktree pair into a single status used for
 * row coloring. Worktree state takes precedence (it's what the user is
 * actively editing); fall back to the index state when nothing is
 * unstaged. Returns null only when both sides are null.
 */
export function deriveFileStatus(file: GitStatusFile): GitFileStatus | null {
  return file.worktree ?? file.index ?? null;
}

/** Build a path → status lookup keyed on the absolute file path. */
export function buildStatusByPath(files: GitStatusFile[]): Map<string, GitFileStatus> {
  const map = new Map<string, GitFileStatus>();
  for (const f of files) {
    const s = deriveFileStatus(f);
    if (s) map.set(f.path, s);
  }
  return map;
}

/**
 * Set of every directory path between (and including) `repoRoot` and the
 * direct parent of any changed file. Lets the file browser tint folders
 * that contain changed descendants without scanning `statusByPath` per
 * row. Cost is O(changed files × avg depth) — negligible for typical
 * repos and runs once per status fetch.
 */
export function computeDirtyAncestors(files: GitStatusFile[], repoRoot: string): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    let dir = posix.dirname(f.path);
    while (dir.startsWith(repoRoot) && dir !== repoRoot) {
      if (out.has(dir)) break;
      out.add(dir);
      const parent = posix.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return out;
}
