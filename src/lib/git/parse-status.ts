import { posix } from "path";
import type { GitFileStatus, GitStatusFile } from "./types";

export interface ParsedPorcelainV2 {
  branch: string | null;
  /** Short SHA when HEAD is detached. */
  detachedHead: string | null;
  ahead: number | null;
  behind: number | null;
  files: GitStatusFile[];
}

/**
 * Parse `git status --porcelain=v2 --branch -z --untracked-files=all` output.
 *
 * Records and header lines are NUL-separated when `-z` is used. Renamed
 * entries (type "2") embed an internal NUL between the new and old paths,
 * so we consume the next token as the orig path.
 *
 * Paths from git are repo-relative; we join them with `repoRoot` (already
 * realpath-resolved by the route's `safePath()` call) so the resulting
 * absolute paths line up with `FileEntry.path` for direct map lookup.
 */
export function parsePorcelainV2(buf: Buffer, repoRoot: string): ParsedPorcelainV2 {
  const result: ParsedPorcelainV2 = {
    branch: null,
    detachedHead: null,
    ahead: null,
    behind: null,
    files: [],
  };

  let headOid: string | null = null;
  let isDetached = false;

  const tokens = splitOnNul(buf);
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    if (raw.length === 0) continue;
    const first = raw[0];

    if (first === 0x23 /* # */) {
      const header = parseHeader(raw.toString("utf-8"));
      if (header.kind === "head") {
        if (header.value === "(detached)") {
          isDetached = true;
          result.branch = null;
        } else {
          result.branch = header.value;
        }
      } else if (header.kind === "oid") {
        headOid = header.value;
      } else if (header.kind === "ab") {
        result.ahead = header.ahead;
        result.behind = header.behind;
      }
      continue;
    }

    if (first === 0x31 /* 1 */ && raw[1] === 0x20) {
      // Ordinary: "1 XY sub mH mI mW hH hI <path>" — 7 spaces precede the path.
      const file = parseOrdinaryOrRenamed(raw.toString("utf-8"), repoRoot, 7);
      if (file) result.files.push(file);
      continue;
    }

    if (first === 0x32 /* 2 */ && raw[1] === 0x20) {
      // Renamed: "2 XY sub mH mI mW hH hI X<score> <path>" — 8 spaces precede.
      const file = parseOrdinaryOrRenamed(raw.toString("utf-8"), repoRoot, 8);
      if (file) result.files.push(file);
      // Consume the orig-path token that follows a renamed entry.
      if (i + 1 < tokens.length) i++;
      continue;
    }

    if (first === 0x75 /* u */ && raw[1] === 0x20) {
      const file = parseUnmerged(raw.toString("utf-8"), repoRoot);
      if (file) result.files.push(file);
      continue;
    }

    if (first === 0x3f /* ? */ && raw[1] === 0x20) {
      const relPath = raw.subarray(2).toString("utf-8");
      result.files.push({
        path: posix.join(repoRoot, relPath),
        index: null,
        worktree: "untracked",
      });
      continue;
    }

    // '!' (ignored) and any unrecognized records: skip silently.
  }

  if (isDetached && headOid) {
    result.detachedHead = headOid.slice(0, 7);
  }

  return result;
}

function splitOnNul(buf: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  let idx = buf.indexOf(0, start);
  while (idx !== -1) {
    parts.push(buf.subarray(start, idx));
    start = idx + 1;
    idx = buf.indexOf(0, start);
  }
  if (start < buf.length) parts.push(buf.subarray(start));
  return parts;
}

type Header =
  | { kind: "head"; value: string }
  | { kind: "oid"; value: string }
  | { kind: "upstream"; value: string }
  | { kind: "ab"; ahead: number; behind: number }
  | { kind: "other" };

function parseHeader(line: string): Header {
  if (line.startsWith("# branch.head ")) return { kind: "head", value: line.slice(14) };
  if (line.startsWith("# branch.oid ")) return { kind: "oid", value: line.slice(13) };
  if (line.startsWith("# branch.upstream ")) return { kind: "upstream", value: line.slice(18) };
  if (line.startsWith("# branch.ab ")) {
    const rest = line.slice(12);
    const m = /^\+(-?\d+) -(-?\d+)$/.exec(rest);
    if (m) return { kind: "ab", ahead: parseInt(m[1], 10), behind: parseInt(m[2], 10) };
  }
  return { kind: "other" };
}

/**
 * Parse a "1" (ordinary) or "2" (renamed/copied) entry. The two formats
 * differ only in field count; the path is everything after the Nth space.
 */
function parseOrdinaryOrRenamed(
  text: string,
  repoRoot: string,
  fieldCount: number,
): GitStatusFile | null {
  let pos = 2;
  let xy: string | null = null;
  for (let i = 0; i < fieldCount; i++) {
    const sp = text.indexOf(" ", pos);
    if (sp === -1) return null;
    if (i === 0) xy = text.slice(pos, sp);
    pos = sp + 1;
  }
  if (!xy) return null;
  const relPath = text.slice(pos);
  const { index, worktree } = decodeXY(xy);
  return {
    path: posix.join(repoRoot, relPath),
    index,
    worktree,
  };
}

function parseUnmerged(text: string, repoRoot: string): GitStatusFile | null {
  const FIELD_COUNT = 9;
  let pos = 2;
  for (let i = 0; i < FIELD_COUNT; i++) {
    const sp = text.indexOf(" ", pos);
    if (sp === -1) return null;
    pos = sp + 1;
  }
  const relPath = text.slice(pos);
  return {
    path: posix.join(repoRoot, relPath),
    index: "conflicted",
    worktree: "conflicted",
  };
}

function decodeXY(xy: string): { index: GitFileStatus | null; worktree: GitFileStatus | null } {
  return {
    index: codeToStatus(xy[0], "index"),
    worktree: codeToStatus(xy[1], "worktree"),
  };
}

function codeToStatus(c: string, side: "index" | "worktree"): GitFileStatus | null {
  switch (c) {
    case ".":
      return null;
    case "M":
      return side === "index" ? "staged" : "modified";
    case "T":
      return side === "index" ? "staged" : "modified";
    case "A":
      return "staged";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "renamed";
    case "U":
      return "conflicted";
    default:
      return null;
  }
}
