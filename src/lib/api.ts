"use client";

import { authFetch } from "@/lib/auth";
import type { ChatSession, ChatMessage, FileEntry } from "@/lib/types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

export class FileApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
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
  let body: { error?: string; code?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body — keep going with the fallback message */
  }
  throw new FileApiError(res.status, body.error || `${fallback} (${res.status})`, body.code);
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

export async function readFile(path: string): Promise<string> {
  const res = await authFetch(`${BASE}/api/files/read?path=${encodeURIComponent(path)}`);
  await assertOk(res, "Failed to read file");
  const data = (await res.json()) as { content: string };
  return data.content;
}

export async function writeFile(path: string, content: string): Promise<void> {
  const res = await authFetch(`${BASE}/api/files/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  await assertOk(res, "Failed to write file");
}

export interface UploadResult {
  path: string;
  /** True when an existing file at the destination was replaced. */
  overwritten?: boolean;
}

export interface UploadOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
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
  const res = await authFetch(`${BASE}/api/files/upload?path=${encodeURIComponent(dirPath)}`, {
    method: "POST",
    body: formData,
    signal: options?.signal,
  });
  await assertOk(res, "Failed to upload file");
  return (await res.json()) as UploadResult;
}

/**
 * Download a file. Uses authenticated fetch + blob URL instead of
 * exposing the auth token in a query string via window.open().
 */
export async function downloadFile(path: string): Promise<void> {
  const res = await authFetch(`${BASE}/api/files/download?path=${encodeURIComponent(path)}`);
  await assertOk(res, "Failed to download file");

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  let filename = path.split("/").pop() || "download";
  const disposition = res.headers.get("Content-Disposition");
  if (disposition) {
    const match = disposition.match(/filename="([^"]+)"/);
    if (match) filename = match[1];
  }

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function deleteFile(path: string, recursive = false): Promise<void> {
  const query = recursive
    ? `path=${encodeURIComponent(path)}&recursive=true`
    : `path=${encodeURIComponent(path)}`;
  const res = await authFetch(`${BASE}/api/files/delete?${query}`, { method: "DELETE" });
  await assertOk(res, "Failed to delete");
}
