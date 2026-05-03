import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Phase 3d (#129): file download relay from preview to user's downloads.
 *
 * When a previewed page triggers a download (`<a download>`, `Content-
 * Disposition: attachment`, etc.), Playwright's `page.on("download")`
 * fires with a `Download` object. We let it save to a fixed dir
 * (`DOWNLOAD_DIR`), register the entry in this module's global Map
 * keyed by UUID, then send a `download_ready` JSON over the WS. The
 * client auto-creates a hidden `<a download>` pointing at our HTTP
 * route (`/api/preview-download/<id>`) and clicks it — the browser's
 * native download UI takes over from there.
 *
 * The Map is module-global (NOT per-WS) because the HTTP route needs
 * to look up the entry independent of the WS handler. The per-WS
 * handler tracks ownership via a `Set<downloadId>` and cancels its
 * own pending downloads on `tearDown`.
 *
 * Security:
 *   - UUID is the unguessable handle.
 *   - HTTP route additionally compares `actorEmail` to the entry's
 *     owner — UUID leak shouldn't grant cross-actor access.
 *   - 500 MB per-file cap (oversize downloads cancelled mid-stream).
 *   - 2 GB total-dir cap (new downloads rejected when over).
 *   - 5 concurrent per WS (prevents bulk-export runaway).
 */

/** 500 MB per file. Stat'd after `download.path()` resolves; oversize
 *  files are unlinked + reported via `download_rejected`. */
export const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

/** 2 GB total dir. Walked via `currentTotalDownloadBytes()` at the
 *  point of new download acceptance; oversize total triggers
 *  `download_rejected` with reason "disk_pressure". */
export const MAX_TOTAL_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** Where Playwright saves downloads. Aligned with `/root/.cache/{images,
 *  unfurls,preview-uploads}` convention. */
export const DOWNLOAD_DIR = "/root/.cache/preview-downloads";

/** TTL after register (or after stream ends if user GETs). Long enough
 *  for the user to review the toast + click; short enough that
 *  abandoned downloads age out fast. */
export const DOWNLOAD_TTL_MS = 5 * 60_000;

/** Per-WS concurrent download cap. Prevents a single page from filling
 *  the disk via parallel `<a download>` triggers. */
export const MAX_CONCURRENT_PER_WS = 5;

/**
 * Minimal interface the module needs from a Playwright `Download`.
 * Keeps the module testable without dragging in playwright-core's
 * type machinery, and lets tests pass mock handles.
 */
export interface DownloadHandle {
  cancel(): Promise<void>;
  delete(): Promise<void>;
}

export interface DownloadEntry {
  id: string;
  /** Absolute path Playwright wrote the file to (under DOWNLOAD_DIR). */
  path: string;
  /** Filename suggested by the previewed page (`Content-Disposition` or `download` attr). */
  suggestedFilename: string;
  /** Size in bytes at register time (stat'd from `path`). */
  size: number;
  /** Email of the WS connection that triggered this download. */
  actorEmail: string;
  /** Playwright handle, kept so we can `cancel()` if the WS closes
   *  before the user GETs the file. Null after first cleanup. */
  handle: DownloadHandle | null;
  /** True while an HTTP GET is streaming the file out. Suspends
   *  cleanup so the sweeper doesn't race the response. */
  inFlight: boolean;
  registeredAt: number;
  /** Pending unlink timer; cleared while inFlight, re-armed after. */
  ttlTimer: NodeJS.Timeout | null;
}

/** Module-global registry. WS handlers register; HTTP route reads. */
const downloads = new Map<string, DownloadEntry>();

/**
 * Loose UUID-shape check — accepts hex+dashes, 16-64 chars. Rejects
 * path-traversal payloads (`../etc/passwd`, etc.) and null bytes
 * before the id ever hits the filesystem. UUID is also used as part
 * of the public URL so it must be URL-safe.
 */
export function validateUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < 16 || value.length > 64) return false;
  return /^[0-9a-fA-F-]+$/.test(value);
}

/** Generate a new download id. node:crypto's randomUUID is RFC 4122 v4. */
export function pickDownloadId(): string {
  return randomUUID();
}

/**
 * Sum the byte sizes of all files in DOWNLOAD_DIR. Used to enforce
 * MAX_TOTAL_DOWNLOAD_BYTES before accepting a new download. Returns 0
 * when the dir doesn't exist yet — gracefully handles cold start.
 */
export async function currentTotalDownloadBytes(): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(DOWNLOAD_DIR);
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of entries) {
    try {
      const s = await stat(join(DOWNLOAD_DIR, name));
      if (s.isFile()) total += s.size;
    } catch {
      /* file vanished mid-iteration */
    }
  }
  return total;
}

export interface RegisterDownloadOptions {
  path: string;
  suggestedFilename: string;
  size: number;
  actorEmail: string;
  handle: DownloadHandle;
}

/**
 * Register a completed download in the global Map. Returns the entry
 * with its newly-minted id. Caller (handler.ts) sends the
 * `download_ready` JSON with `entry.id` so the client can construct
 * the GET URL.
 */
export function registerDownload(opts: RegisterDownloadOptions): DownloadEntry {
  const id = pickDownloadId();
  const entry: DownloadEntry = {
    id,
    path: opts.path,
    suggestedFilename: opts.suggestedFilename,
    size: opts.size,
    actorEmail: opts.actorEmail,
    handle: opts.handle,
    inFlight: false,
    registeredAt: Date.now(),
    ttlTimer: null,
  };
  downloads.set(id, entry);
  scheduleCleanup(entry);
  return entry;
}

/**
 * Look up a download by id, gated on `actorEmail` ownership match.
 * Returns null on any miss (UUID-invalid, no entry, wrong owner) so
 * the HTTP route can return a single 404 for all failure modes —
 * doesn't leak "valid id, wrong owner".
 */
export function getDownload(id: string, actorEmail: string): DownloadEntry | null {
  if (!validateUuid(id)) return null;
  const entry = downloads.get(id);
  if (!entry) return null;
  if (entry.actorEmail !== actorEmail) return null;
  return entry;
}

/**
 * Mark a download as currently being streamed out via the HTTP route.
 * Cancels the pending cleanup timer so the sweeper doesn't race the
 * response. Caller MUST call `clearInFlight` (or `cancelDownload`) on
 * stream end / abort.
 */
export function markInFlight(id: string): void {
  const entry = downloads.get(id);
  if (!entry) return;
  entry.inFlight = true;
  if (entry.ttlTimer) {
    clearTimeout(entry.ttlTimer);
    entry.ttlTimer = null;
  }
}

/**
 * Re-arm cleanup after the GET response completes successfully.
 * The file gets unlinked DOWNLOAD_TTL_MS later (lets browsers retry
 * partial fetches if needed; not strictly required).
 */
export function clearInFlight(id: string): void {
  const entry = downloads.get(id);
  if (!entry) return;
  entry.inFlight = false;
  scheduleCleanup(entry);
}

function scheduleCleanup(entry: DownloadEntry): void {
  if (entry.ttlTimer) clearTimeout(entry.ttlTimer);
  entry.ttlTimer = setTimeout(() => {
    void cancelDownload(entry.id);
  }, DOWNLOAD_TTL_MS);
}

/**
 * Tear a download down: drop the Map entry, cancel the Playwright
 * handle if it's still alive, unlink the file. Idempotent — safe to
 * call from tearDown, the TTL timer, or the sweeper.
 */
export async function cancelDownload(id: string): Promise<void> {
  const entry = downloads.get(id);
  if (!entry) return;
  downloads.delete(id);
  if (entry.ttlTimer) {
    clearTimeout(entry.ttlTimer);
    entry.ttlTimer = null;
  }
  const handle = entry.handle;
  entry.handle = null;
  if (handle) {
    try {
      await handle.cancel();
    } catch {
      /* may have already completed */
    }
    try {
      await handle.delete();
    } catch {
      /* delete() unlinks Playwright's copy — may already be gone */
    }
  }
  try {
    await unlink(entry.path);
  } catch {
    /* file may already be gone */
  }
}

/**
 * Boot-time + recurring safety net. Walks DOWNLOAD_DIR and unlinks
 * any file older than DOWNLOAD_TTL_MS that isn't currently in-flight.
 * Mirror of `sweepStaleDrops()` in file-drop.ts.
 */
export async function sweepStaleDownloads(): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(DOWNLOAD_DIR);
  } catch {
    return;
  }
  const cutoff = Date.now() - DOWNLOAD_TTL_MS;
  // Build a path → entry index for fast in-flight lookup.
  const inFlightPaths = new Set<string>();
  for (const e of downloads.values()) {
    if (e.inFlight) inFlightPaths.add(e.path);
  }
  await Promise.all(
    entries.map(async (name) => {
      const p = join(DOWNLOAD_DIR, name);
      if (inFlightPaths.has(p)) return;
      try {
        const s = await stat(p);
        if (s.mtimeMs < cutoff) {
          await unlink(p).catch(() => {
            /* race with another sweeper / per-entry timer */
          });
        }
      } catch {
        /* file vanished mid-iteration */
      }
    }),
  );
}

/** Test-only: clear the registry between tests so state doesn't leak. */
export function _resetDownloadsForTests(): void {
  for (const entry of downloads.values()) {
    if (entry.ttlTimer) clearTimeout(entry.ttlTimer);
  }
  downloads.clear();
}

/** Test-only: snapshot of the Map size. */
export function _downloadsCount(): number {
  return downloads.size;
}
