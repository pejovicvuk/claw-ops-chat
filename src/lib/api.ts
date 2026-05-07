"use client";

import { authFetch } from "@/lib/auth";
import type { ChatSession, ChatMessage, FileEntry } from "@/lib/types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

export class FileApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    /**
     * The full JSON body returned by the server, when one was parseable.
     * Lets callers introspect richer error payloads (e.g. the 409 conflict
     * response from `/api/files/write` carries `currentMtimeMs` and
     * `currentContent` for the editor's stale-write banner).
     */
    public body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FileApiError";
  }
}

/**
 * Assert a `Response` is OK, otherwise throw a `FileApiError` built from the
 * server's JSON body (`{ error, code }`). Used by every file API helper so
 * that callers can distinguish 401/403/413 and the machine-readable `code`.
 */
async function assertOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body — keep going with the fallback message */
  }
  const error = typeof body.error === "string" ? body.error : null;
  const code = typeof body.code === "string" ? body.code : undefined;
  throw new FileApiError(res.status, error || `${fallback} (${res.status})`, code, body);
}

/* ── Sessions ── */

export async function fetchSessions(): Promise<ChatSession[]> {
  const res = await authFetch(`${BASE}/api/sessions`);
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

export interface SessionMessagesResponse {
  messages: ChatMessage[];
  contextUsage: { used: number; max: number; percentage: number } | null;
  sessionCwd: string | null;
}

export async function fetchSessionMessages(sessionId: string): Promise<SessionMessagesResponse> {
  const res = await authFetch(`${BASE}/api/sessions/${encodeURIComponent(sessionId)}/messages`);
  if (!res.ok) throw new Error("Failed to fetch session messages");
  const data = await res.json();
  if (Array.isArray(data)) return { messages: data, contextUsage: null, sessionCwd: null };
  return data as SessionMessagesResponse;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await authFetch(`${BASE}/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Failed to delete session (HTTP ${res.status})`);
  }
}

/* ── Files ── */

export async function listFiles(path: string): Promise<FileEntry[]> {
  const res = await authFetch(`${BASE}/api/files/list?path=${encodeURIComponent(path)}`);
  await assertOk(res, "Failed to list files");
  return res.json();
}

export interface WorkspaceIndexResponse {
  rootResolved: string;
  entries: Array<{ name: string; path: string; directory: boolean }>;
  truncated: boolean;
  elapsedMs: number;
}

/**
 * Recursively list every file under `root`, with sensible excludes
 * (node_modules, .git, build dirs) applied server-side. Backs the `@`
 * autocomplete's "global" search mode. Expensive — call once, cache.
 */
export async function searchWorkspace(
  root: string = "~",
  limit: number = 20_000,
): Promise<WorkspaceIndexResponse> {
  const qs = `root=${encodeURIComponent(root)}&limit=${encodeURIComponent(String(limit))}`;
  const res = await authFetch(`${BASE}/api/files/search?${qs}`);
  await assertOk(res, "Failed to index files");
  return res.json();
}

export interface ReadFileResult {
  content: string;
  size: number;
  /** ms epoch — pass back as `expectedMtimeMs` on the next save to enable conflict detection. */
  mtimeMs: number;
  /**
   * Canonical (realpath-resolved) path of the file. Differs from the
   * caller-supplied `path` when the request traversed a symlink.
   * Consumers comparing path identity (e.g. file-change-bus subscribers)
   * should key off this value so they match the server's own canonical
   * identity.
   */
  path: string;
}

export async function readFile(path: string): Promise<ReadFileResult> {
  const res = await authFetch(`${BASE}/api/files/read?path=${encodeURIComponent(path)}`);
  await assertOk(res, "Failed to read file");
  return (await res.json()) as ReadFileResult;
}

export interface WriteFileResult {
  /** ms epoch of the file after the write — store this for the next save. */
  mtimeMs: number;
}

export interface WriteFileOptions {
  /**
   * The mtime returned by the most recent `readFile` call. When set, the
   * server returns 409 with `code: "stale_mtime"` if the file changed on
   * disk since you read it. Omit for unconditional overwrite (legacy
   * behavior — use only for "create new file" flows where conflict
   * detection is not meaningful).
   */
  expectedMtimeMs?: number;
}

export async function writeFile(
  path: string,
  content: string,
  options: WriteFileOptions = {},
): Promise<WriteFileResult> {
  const payload: { path: string; content: string; expectedMtimeMs?: number } = { path, content };
  if (typeof options.expectedMtimeMs === "number") {
    payload.expectedMtimeMs = options.expectedMtimeMs;
  }
  const res = await authFetch(`${BASE}/api/files/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await assertOk(res, "Failed to write file");
  const data = (await res.json()) as Partial<WriteFileResult>;
  return { mtimeMs: typeof data.mtimeMs === "number" ? data.mtimeMs : 0 };
}

/**
 * Create a folder. With `recursive:true` (default for batch uploads), missing
 * parent directories are created in one call and existing ones are not an
 * error.
 */
export async function createFolder(
  path: string,
  opts: { name?: string; recursive?: boolean } = {},
): Promise<void> {
  const res = await authFetch(`${BASE}/api/files/mkdir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, name: opts.name, recursive: opts.recursive === true }),
  });
  await assertOk(res, "Failed to create folder");
}

export interface UploadResult {
  path: string;
  /** True when an existing file at the destination was replaced. */
  overwritten?: boolean;
}

export interface UploadOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /**
   * Optional path (relative to `dirPath`) where the file should land. Used
   * by folder uploads — e.g. `"src/lib/foo.ts"` drops the file into
   * `<dirPath>/src/lib/foo.ts`, with the server creating parent dirs.
   */
  relativePath?: string;
}

export async function uploadFile(
  dirPath: string,
  file: File,
  options?: UploadOptions,
): Promise<UploadResult> {
  // Prefer XHR so progress events are available; fall back to fetch
  // (which the browser already sends credentials for via authFetch's
  // credentials: "same-origin") when XHR is unavailable (old SSR, JSDOM).
  if (typeof XMLHttpRequest !== "undefined") {
    const { uploadFileXhr } = await import("@/lib/upload-xhr");
    return uploadFileXhr(dirPath, file, options);
  }
  const formData = new FormData();
  formData.append("file", file);
  if (options?.relativePath) {
    formData.append("relativePath", options.relativePath);
  }
  const res = await authFetch(`${BASE}/api/files/upload?path=${encodeURIComponent(dirPath)}`, {
    method: "POST",
    body: formData,
    signal: options?.signal,
  });
  await assertOk(res, "Failed to upload file");
  return (await res.json()) as UploadResult;
}

/**
 * Download a file. Thin wrapper around `downloadFileWithProgress` that
 * discards progress events — preserved for callers that don't need
 * progress feedback. Surfaces with progress UI should call
 * `useDownload()` (in `use-download.ts`) directly.
 */
export async function downloadFile(path: string): Promise<void> {
  // Lazy import to avoid pulling the XHR helper into bundles that don't
  // touch downloads (and to keep the previous module graph identical).
  const { downloadFileWithProgress } = await import("@/lib/download-xhr");
  await downloadFileWithProgress(path);
}

export async function deleteFile(path: string, recursive = false): Promise<void> {
  const query = recursive
    ? `path=${encodeURIComponent(path)}&recursive=true`
    : `path=${encodeURIComponent(path)}`;
  const res = await authFetch(`${BASE}/api/files/delete?${query}`, { method: "DELETE" });
  await assertOk(res, "Failed to delete");
}
