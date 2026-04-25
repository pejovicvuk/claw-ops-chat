import type { WorkspaceIndexEntry } from "@/lib/use-workspace-index";

/**
 * Pure file-name resolution against a workspace-index snapshot.
 *
 * The chat agent often refers to files by bare basename (`report.pdf`) or
 * relative path (`notes/draft.md`) without a leading `/` / `~/` / `./`
 * anchor. The detector emits these as `candidate` segments; this module
 * resolves them to absolute paths so the standard preview pipeline
 * (`<FilePathPill>` / `<FileCard>`) can render them.
 *
 * Resolution rules (in order):
 *   1. If `sessionCwd` is set, prefer an entry whose path equals
 *      `<sessionCwd>/<candidate>` — the assistant's most natural
 *      "report.pdf" reference is relative to the session's working dir.
 *   2. Else, look up by basename for bare candidates, or scan basename-
 *      matched entries for `/<candidate>` suffix for relative candidates.
 *      Return the path only if exactly one entry qualifies — ambiguous
 *      matches stay plain text (conservative, false-positive-averse).
 *
 * Pure functions — no React, no I/O, easy to unit-test.
 */

export interface ResolverMaps {
  /** lowercase basename → entries that share it. Files only, no directories. */
  byBasename: Map<string, WorkspaceIndexEntry[]>;
}

export function buildResolverMaps(entries: readonly WorkspaceIndexEntry[]): ResolverMaps {
  const byBasename = new Map<string, WorkspaceIndexEntry[]>();
  for (const e of entries) {
    if (e.directory) continue;
    const key = e.name.toLowerCase();
    const bucket = byBasename.get(key);
    if (bucket) bucket.push(e);
    else byBasename.set(key, [e]);
  }
  return { byBasename };
}

export interface ResolveOptions {
  sessionCwd?: string | null;
}

function joinCwd(cwd: string, rel: string): string {
  return cwd.endsWith("/") ? cwd + rel : cwd + "/" + rel;
}

/**
 * Resolve a single candidate against the workspace maps. Returns the
 * absolute path of the matching entry, or null when zero or multiple
 * entries match.
 */
export function resolveCandidate(
  candidate: string,
  maps: ResolverMaps,
  opts: ResolveOptions = {},
): string | null {
  if (!candidate) return null;
  const cwd = opts.sessionCwd ?? null;
  const slash = candidate.lastIndexOf("/");
  const basename = (slash === -1 ? candidate : candidate.slice(slash + 1)).toLowerCase();
  const bucket = maps.byBasename.get(basename);
  if (!bucket || bucket.length === 0) return null;

  // 1) sessionCwd-relative match wins outright.
  if (cwd) {
    const target = joinCwd(cwd, candidate);
    const cwdHit = bucket.find((e) => e.path === target);
    if (cwdHit) return cwdHit.path;
  }

  // 2) For relative-with-slash candidates, narrow by suffix match.
  let qualifying = bucket;
  if (slash !== -1) {
    const suffix = "/" + candidate;
    qualifying = bucket.filter((e) => e.path.endsWith(suffix));
  }

  if (qualifying.length === 1) return qualifying[0].path;
  return null;
}
