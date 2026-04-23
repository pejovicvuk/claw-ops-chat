import { readdir } from "fs/promises";
import { join } from "path";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { safePath, SafePathError } from "@/lib/safe-path";
import { SEARCH_EXCLUDED_DIR_NAMES } from "@/lib/search-excludes";

/**
 * Build a flat index of files under a root directory.
 *
 * GET /api/files/search?root=~&limit=20000
 *   → { rootResolved, entries: [{ name, path, directory }], truncated, elapsedMs }
 *
 * Used by the chat composer's `@` autocomplete in global mode (user
 * types `@foo` with no slash — we fuzzy-search the whole workspace
 * client-side). `~/src/lib/foo` autocomplete stays on the existing
 * single-directory `/api/files/list` route; this one is the broader
 * catch.
 *
 * Walk semantics:
 * - BFS with a queue so we can cap by entry count without a stack
 *   explosion on huge trees.
 * - Skip directory names from `SEARCH_EXCLUDED_DIR_NAMES` (node_modules,
 *   .git, dist, …). Name-based, no glob / gitignore parsing — see
 *   `src/lib/search-excludes.ts` for rationale.
 * - Don't follow symlinks. `readdir withFileTypes` exposes them; we
 *   just skip `isSymbolicLink()` to avoid loops and keep the walk
 *   fast.
 * - Hard cap at `limit` (default 20 000). Sets `truncated: true` when
 *   reached, returns what we have.
 */

const DEFAULT_LIMIT = 20_000;
const MAX_LIMIT = 50_000;

interface IndexEntry {
  name: string;
  path: string;
  directory: boolean;
}

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const url = new URL(request.url);
  const rawRoot = url.searchParams.get("root") || "~";
  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  let rootResolved: string;
  try {
    rootResolved = await safePath(rawRoot);
  } catch (err) {
    if (err instanceof SafePathError) {
      return Response.json({ error: "Access denied", code: "safe_path" }, { status: 403 });
    }
    return Response.json({ error: "Invalid path", code: "invalid_path" }, { status: 400 });
  }

  const started = Date.now();
  const entries: IndexEntry[] = [];
  let truncated = false;

  // BFS with a single mutable queue. `while (queue.length)` with shift
  // is O(n) amortized in V8 for small batches; we trade a nicer worst-
  // case for the simpler code. At 20 k entries the measured overhead is
  // <10 ms on a modern laptop, dwarfed by readdir.
  const queue: string[] = [rootResolved];

  try {
    while (queue.length > 0) {
      const dir = queue.shift()!;
      let dirents;
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      } catch {
        // Permission denied, transient error — skip this subtree.
        continue;
      }
      for (const d of dirents) {
        if (entries.length >= limit) {
          truncated = true;
          break;
        }
        if (d.isSymbolicLink()) continue;
        const full = join(dir, d.name);
        const isDir = d.isDirectory();
        if (isDir && SEARCH_EXCLUDED_DIR_NAMES.has(d.name)) continue;
        entries.push({ name: d.name, path: full, directory: isDir });
        if (isDir) queue.push(full);
      }
      if (truncated) break;
    }
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Walk failed" },
      { status: 500 },
    );
  }

  return Response.json({
    rootResolved,
    entries,
    truncated,
    elapsedMs: Date.now() - started,
  });
}
