import { SEARCH_EXCLUDED_DIR_NAMES } from "./search-excludes";
import type { WorkspaceIndexEntry } from "./use-workspace-index";

/**
 * Pure file-name resolution against a workspace-index snapshot.
 *
 * The chat agent often refers to files by bare basename (`report.pdf`) or
 * relative path (`notes/draft.md`) without a leading `/` / `~/` / `./`
 * anchor. The detector emits these as `candidate` segments; this module
 * resolves them to absolute paths so the standard preview pipeline
 * (`<FilePathPill>` / `<FileCard>`) can render them.
 *
 * Resolution rules (in order, highest weight first):
 *   1. `<sessionCwd>/<candidate>` exact hit — outright winner.
 *   2. For relative-with-slash candidates, narrow to entries whose path
 *      ends with `/<candidate>`.
 *   3. Score the remaining entries by **directory affinity** to any path
 *      already referenced in this chat (`referencedPaths`) — segment-
 *      aligned longest common prefix, max across all referenced paths.
 *   4. Apply a small penalty for paths that contain
 *      `SEARCH_EXCLUDED_DIR_NAMES` segments (`node_modules`, `.git`, …)
 *      so junk wins less often when the chat has no context yet.
 *   5. Tiebreakers: shorter path first (top-level beats nested), then
 *      alphabetical for determinism.
 *
 * Returns the best-scored entry's path, or null only when the basename
 * has zero workspace matches at all (or the suffix filter eliminated
 * everything for a relative candidate).
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
  /**
   * Paths already resolved/referenced earlier in this chat. Used to
   * disambiguate matches by directory affinity — a candidate whose
   * directory overlaps heavily with paths already touched wins.
   *
   * Stable identity matters: callers should keep the array reference
   * stable (e.g. via the chat-files context) so resolver consumers
   * memoize correctly.
   */
  referencedPaths?: readonly string[];
}

const AFFINITY_WEIGHT = 100; // points per shared directory segment
const EXCLUDED_PENALTY = 50; // points per `node_modules`-like segment in the path

function joinCwd(cwd: string, rel: string): string {
  return cwd.endsWith("/") ? cwd + rel : cwd + "/" + rel;
}

function dirSegments(absPath: string): string[] {
  // Drop empty leading segment from absolute paths and the basename.
  const parts = absPath.split("/").filter(Boolean);
  return parts.slice(0, -1);
}

function sharedDirSegments(a: string, b: string): number {
  const aSeg = dirSegments(a);
  const bSeg = dirSegments(b);
  const max = Math.min(aSeg.length, bSeg.length);
  let n = 0;
  for (let i = 0; i < max; i++) {
    if (aSeg[i] === bSeg[i]) n++;
    else break;
  }
  return n;
}

function excludedSegmentCount(absPath: string): number {
  let n = 0;
  for (const seg of absPath.split("/")) {
    if (seg && SEARCH_EXCLUDED_DIR_NAMES.has(seg)) n++;
  }
  return n;
}

function scoreEntry(entry: WorkspaceIndexEntry, referencedPaths: readonly string[]): number {
  let affinity = 0;
  for (const ref of referencedPaths) {
    const shared = sharedDirSegments(entry.path, ref);
    if (shared > affinity) affinity = shared;
  }
  return affinity * AFFINITY_WEIGHT - excludedSegmentCount(entry.path) * EXCLUDED_PENALTY;
}

/**
 * Resolve a single candidate against the workspace maps.
 *
 * Returns the best-scored entry's absolute path, or null only when the
 * basename has zero workspace matches (or, for relative candidates, no
 * entry's path ends with the requested suffix). Ambiguous matches now
 * always pick a winner via the scoring rules above — the previous
 * "ambiguous → null" behaviour was deliberately tightened so every
 * mention with a real workspace file becomes a clickable preview.
 */
export function resolveCandidate(
  candidate: string,
  maps: ResolverMaps,
  opts: ResolveOptions = {},
): string | null {
  if (!candidate) return null;
  const cwd = opts.sessionCwd ?? null;
  const referencedPaths = opts.referencedPaths ?? [];
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
    if (qualifying.length === 0) return null;
  }

  if (qualifying.length === 1) return qualifying[0].path;

  // 3 + 4) Score, then sort with deterministic tiebreakers.
  const scored = qualifying.map((entry) => ({
    entry,
    score: scoreEntry(entry, referencedPaths),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.entry.path.length !== b.entry.path.length) {
      return a.entry.path.length - b.entry.path.length;
    }
    return a.entry.path.localeCompare(b.entry.path);
  });

  return scored[0].entry.path;
}
