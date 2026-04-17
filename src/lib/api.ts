"use client";

import { authFetch } from "@/lib/auth";
import type { ChatSession, ChatMessage, FileEntry } from "@/lib/types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

export class FileApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "FileApiError";
  }
}

/* ── Sessions ── */

export async function fetchSessions(): Promise<ChatSession[]> {
  const res = await authFetch(`${BASE}/api/sessions`);
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

export async function fetchSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const res = await authFetch(`${BASE}/api/sessions/${encodeURIComponent(sessionId)}/messages`);
  if (!res.ok) throw new Error("Failed to fetch session messages");
  return res.json();
}

/* ── Files ── */

export async function listFiles(path: string): Promise<FileEntry[]> {
  const res = await authFetch(`${BASE}/api/files/list?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new FileApiError(res.status, body.error || `Failed to list files (${res.status})`);
  }
  return res.json();
}

export async function readFile(path: string): Promise<string> {
  const res = await authFetch(`${BASE}/api/files/read?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error("Failed to read file");
  const data = await res.json();
  return data.content;
}

export async function writeFile(path: string, content: string): Promise<void> {
  const res = await authFetch(`${BASE}/api/files/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) throw new Error("Failed to write file");
}

export async function uploadFile(dirPath: string, file: File): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await authFetch(`${BASE}/api/files/upload?path=${encodeURIComponent(dirPath)}`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("Failed to upload file");
}

/**
 * Download a file. Uses authenticated fetch + blob URL instead of
 * exposing the auth token in a query string via window.open().
 */
export async function downloadFile(path: string): Promise<void> {
  const res = await authFetch(`${BASE}/api/files/download?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error("Failed to download file");

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  // Extract filename from Content-Disposition header or fall back to path basename
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

export async function deleteFile(path: string): Promise<void> {
  const res = await authFetch(`${BASE}/api/files/delete?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete file");
}
