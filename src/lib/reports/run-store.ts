import { existsSync } from "fs";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "fs/promises";
import { INDEX_PATH, RUNS_DIR, ensureReportsTree, jobRunsDir, runSidecarPath } from "./paths";
import type { ReportRun, ReportsIndex, ReportsIndexEntry, RunStatus } from "./types";

/**
 * Storage for run sidecars and the central read/unread index.
 *
 * - Sidecars: one JSON per run at /root/reports/.runs/<slug>/<runId>.json.
 * - Index: single JSON at /root/reports/.index.json, capped at
 *   MAX_INDEX_ENTRIES newest-first, trimmed on every mutation.
 *
 * Both writes go through write-then-rename for atomicity.
 */

const MAX_INDEX_ENTRIES = 1000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z?$/;

function assertSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) throw new Error(`Invalid job slug: ${slug}`);
}

function assertRunId(runId: string): void {
  if (!RUN_ID_RE.test(runId)) throw new Error(`Invalid runId: ${runId}`);
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, path);
}

/**
 * Build a runId from a slug and an ISO timestamp. Filesystem-safe
 * (":" and "." from ISO-8601 are replaced with "-").
 */
export function makeRunId(slug: string, now: Date = new Date()): string {
  const iso = now
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/-\d{3}Z$/, "Z");
  return `${slug}-${iso}`;
}

/** Write (or overwrite) a run sidecar. */
export async function writeRunSidecar(run: ReportRun): Promise<void> {
  assertSlug(run.jobId);
  assertRunId(run.runId);
  await ensureReportsTree();
  const dir = jobRunsDir(run.jobId);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await atomicWrite(runSidecarPath(run.jobId, run.runId), JSON.stringify(run, null, 2));
}

export async function readRunSidecar(slug: string, runId: string): Promise<ReportRun | null> {
  assertSlug(slug);
  assertRunId(runId);
  const path = runSidecarPath(slug, runId);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as ReportRun;
  } catch {
    return null;
  }
}

export async function deleteRunSidecar(slug: string, runId: string): Promise<void> {
  assertSlug(slug);
  assertRunId(runId);
  const path = runSidecarPath(slug, runId);
  if (existsSync(path)) await unlink(path);
}

/** List all sidecars for one job, newest first. */
export async function listRunsForJob(slug: string): Promise<ReportRun[]> {
  assertSlug(slug);
  const dir = jobRunsDir(slug);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const out: ReportRun[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(`${dir}/${name}`, "utf-8");
      out.push(JSON.parse(raw) as ReportRun);
    } catch {
      /* skip corrupt */
    }
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

export interface RunCountStats {
  total: number;
  success: number;
  error: number;
  running: number;
  /** ms epoch of the most-recent run's startedAt, or null if no runs. */
  lastRunAt: number | null;
  /** Status of the most-recent run (by startedAt), or null if no runs. */
  lastRunStatus: RunStatus | null;
}

/**
 * Aggregate counts for a single job — used by the dashboard to show
 * "N runs · M% success" without the client having to fetch the full run
 * list. Reads sidecars directly (not the index) so disabled/archived
 * jobs with live runs still count correctly.
 */
export async function countRunsForJob(slug: string): Promise<RunCountStats> {
  assertSlug(slug);
  const dir = jobRunsDir(slug);
  const stats: RunCountStats = {
    total: 0,
    success: 0,
    error: 0,
    running: 0,
    lastRunAt: null,
    lastRunStatus: null,
  };
  if (!existsSync(dir)) return stats;
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(`${dir}/${name}`, "utf-8");
      const run = JSON.parse(raw) as ReportRun;
      stats.total += 1;
      if (run.status === "success") stats.success += 1;
      else if (run.status === "running") stats.running += 1;
      else stats.error += 1;
      if (!stats.lastRunAt || run.startedAt > stats.lastRunAt) {
        stats.lastRunAt = run.startedAt;
        stats.lastRunStatus = run.status;
      }
    } catch {
      /* skip corrupt */
    }
  }
  return stats;
}

/* ------------------------------------------------------------------ */
/*  Read/unread index                                                  */
/* ------------------------------------------------------------------ */

const EMPTY_INDEX: ReportsIndex = { version: 1, runs: [] };

export async function readIndex(): Promise<ReportsIndex> {
  if (!existsSync(INDEX_PATH)) return EMPTY_INDEX;
  try {
    const raw = await readFile(INDEX_PATH, "utf-8");
    const parsed = JSON.parse(raw) as ReportsIndex;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.runs)) {
      return parsed;
    }
  } catch {
    /* corrupt — rebuild from scratch */
  }
  return EMPTY_INDEX;
}

async function writeIndex(index: ReportsIndex): Promise<void> {
  await ensureReportsTree();
  // Trim on every write so the file stays bounded.
  if (index.runs.length > MAX_INDEX_ENTRIES) {
    index.runs = index.runs.slice(0, MAX_INDEX_ENTRIES);
  }
  await atomicWrite(INDEX_PATH, JSON.stringify(index, null, 2));
}

/**
 * Upsert a run into the index. If the runId already exists, its fields are
 * updated in place (preserving readAt unless explicitly overwritten). New
 * entries land at the top (newest-first).
 */
export async function upsertIndexEntry(entry: ReportsIndexEntry): Promise<void> {
  const index = await readIndex();
  const existingIdx = index.runs.findIndex((e) => e.runId === entry.runId);
  if (existingIdx >= 0) {
    // Preserve readAt unless the caller explicitly sent a new one.
    const existing = index.runs[existingIdx];
    index.runs[existingIdx] = {
      ...existing,
      ...entry,
      readAt: entry.readAt !== undefined ? entry.readAt : existing.readAt,
    };
  } else {
    index.runs.unshift(entry);
  }
  await writeIndex(index);
}

/** Mark a run's readAt. Pass null to mark unread. */
export async function setIndexReadAt(runId: string, readAt: number | null): Promise<void> {
  const index = await readIndex();
  const entry = index.runs.find((e) => e.runId === runId);
  if (!entry) return;
  entry.readAt = readAt;
  await writeIndex(index);
}

/** Remove a run from the index. */
export async function removeIndexEntry(runId: string): Promise<void> {
  const index = await readIndex();
  const next = index.runs.filter((e) => e.runId !== runId);
  if (next.length === index.runs.length) return;
  index.runs = next;
  await writeIndex(index);
}

/**
 * Boot-time reconciliation: any sidecar with status="running" whose
 * startedAt is older than `staleMs` is marked "aborted" with an
 * explanatory errorMessage. This catches runs orphaned by a server
 * crash mid-execution.
 */
export async function reconcileCrashedRuns(staleMs = 30 * 60 * 1000): Promise<number> {
  if (!existsSync(RUNS_DIR)) return 0;
  const slugs = await readdir(RUNS_DIR).catch(() => [] as string[]);
  const cutoff = Date.now() - staleMs;
  let repaired = 0;
  for (const slug of slugs) {
    if (!SLUG_RE.test(slug)) continue;
    const runs = await listRunsForJob(slug).catch(() => [] as ReportRun[]);
    for (const run of runs) {
      if (run.status === "running" && run.startedAt < cutoff) {
        const updated: ReportRun = {
          ...run,
          status: "aborted" as RunStatus,
          finishedAt: run.finishedAt ?? Date.now(),
          errorMessage: "Server crashed or process was killed during run",
        };
        await writeRunSidecar(updated);
        await upsertIndexEntry({
          runId: updated.runId,
          jobId: updated.jobId,
          jobName: updated.jobId,
          createdAt: updated.startedAt,
          reportPath: updated.reportPath,
          status: updated.status,
          readAt: null,
        });
        repaired += 1;
      }
    }
  }
  return repaired;
}

/**
 * Recompute the read/unread index from the sidecar files on disk.
 *
 * Use this when the index is corrupt, has been deleted, or has drifted
 * from the underlying sidecars (e.g. the 1000-entry cap silently dropped
 * older runs that the user still wants to see). Walks every sidecar in
 * RUNS_DIR/<slug>/<runId>.json, sorts newest-first, caps at
 * MAX_INDEX_ENTRIES, and preserves the `readAt` of any prior index entry
 * whose sidecar still exists.
 *
 * Returns counts so callers can show a "rebuilt N entries" toast.
 */
export async function rebuildIndexFromSidecars(): Promise<{ added: number; pruned: number }> {
  await ensureReportsTree();

  const prior = await readIndex();
  const priorReadAt = new Map<string, number | null>();
  for (const entry of prior.runs) {
    priorReadAt.set(entry.runId, entry.readAt);
  }

  const slugs = await readdir(RUNS_DIR).catch(() => [] as string[]);
  const entries: ReportsIndexEntry[] = [];
  for (const slug of slugs) {
    if (!SLUG_RE.test(slug)) continue;
    const runs = await listRunsForJob(slug).catch(() => [] as ReportRun[]);
    for (const run of runs) {
      entries.push({
        runId: run.runId,
        jobId: run.jobId,
        // jobName isn't on the sidecar — use the slug as a sensible
        // fallback. Live writes via upsertIndexEntry will overwrite this
        // with the real name on the next run.
        jobName: run.jobId,
        createdAt: run.startedAt,
        reportPath: run.reportPath,
        status: run.status,
        readAt: priorReadAt.has(run.runId) ? (priorReadAt.get(run.runId) ?? null) : null,
      });
    }
  }
  entries.sort((a, b) => b.createdAt - a.createdAt);
  const capped = entries.slice(0, MAX_INDEX_ENTRIES);

  const next: ReportsIndex = { version: 1, runs: capped };
  await atomicWrite(INDEX_PATH, JSON.stringify(next, null, 2));

  // "pruned" = entries that were in the old index but no longer have a
  // sidecar on disk. "added" = entries written to the new index that
  // weren't in the old one.
  const newIds = new Set(capped.map((e) => e.runId));
  const oldIds = new Set(prior.runs.map((e) => e.runId));
  let added = 0;
  for (const id of newIds) if (!oldIds.has(id)) added += 1;
  let pruned = 0;
  for (const id of oldIds) if (!newIds.has(id)) pruned += 1;

  return { added, pruned };
}

export const __INTERNAL = { MAX_INDEX_ENTRIES, SLUG_RE, RUN_ID_RE };
