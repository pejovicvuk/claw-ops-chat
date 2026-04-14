"use client";

import { authFetch } from "@/lib/auth";
import type { ChatSession, ChatMessage, FileEntry } from "@/lib/types";

/* ── Sessions ── */

export async function fetchSessions(): Promise<ChatSession[]> {
  const res = await authFetch("/api/sessions");
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

export async function fetchSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const res = await authFetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
  if (!res.ok) throw new Error("Failed to fetch session messages");
  return res.json();
}

/* ── Files ── */

export async function listFiles(path: string): Promise<FileEntry[]> {
  const res = await authFetch(`/api/files/list?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error("Failed to list files");
  return res.json();
}

export async function readFile(path: string): Promise<string> {
  const res = await authFetch(`/api/files/read?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error("Failed to read file");
  const data = await res.json();
  return data.content;
}

export async function writeFile(path: string, content: string): Promise<void> {
  const res = await authFetch("/api/files/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) throw new Error("Failed to write file");
}

export async function uploadFile(dirPath: string, file: File): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await authFetch(`/api/files/upload?path=${encodeURIComponent(dirPath)}`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("Failed to upload file");
}

export function downloadFile(path: string): void {
  const token = typeof window !== "undefined"
    ? sessionStorage.getItem("claw-chat-token:v1") || ""
    : "";
  window.open(`/api/files/download?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`);
}

export async function deleteFile(path: string): Promise<void> {
  const res = await authFetch(`/api/files/delete?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete file");
}
