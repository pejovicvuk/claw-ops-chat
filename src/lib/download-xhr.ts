"use client";

import { FileApiError } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

export interface DownloadProgressEvent {
  loaded: number;
  total: number;
  fraction: number;
}

export interface DownloadOptions {
  onProgress?: (e: DownloadProgressEvent) => void;
  signal?: AbortSignal;
}

export interface DownloadResult {
  filename: string;
  bytes: number;
}

/**
 * Parse `Content-Disposition: attachment; filename="x"; filename*=UTF-8''<enc>`
 * preferring the RFC-5987 `filename*` value when present.
 */
function parseFilename(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*([^;]+)/i.exec(header);
  if (star) {
    const raw = star[1].trim();
    const m = /^[^']*'[^']*'(.*)$/.exec(raw);
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        /* fall through to plain filename */
      }
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  if (plain) return plain[1].trim();
  return fallback;
}

/**
 * Save a `Blob` to disk via a hidden anchor click. Works on desktop and
 * Android Chrome reliably; on iOS Safari this triggers the standard
 * "open this file" prompt where the user can Save to Files. The blob
 * URL is revoked after a short delay because Safari needs it alive
 * while the click handler is processing.
 */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Download a file via XHR so we can emit progress events (the fetch API
 * still doesn't expose download progress as of 2026). Streams into a
 * Blob, parses Content-Disposition for the filename, then triggers a
 * native save. Honours an AbortSignal — wired through `xhr.abort()`.
 */
export function downloadFileWithProgress(
  path: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  return new Promise<DownloadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${BASE}/api/files/download?path=${encodeURIComponent(path)}`;

    xhr.open("GET", url, true);
    xhr.withCredentials = true;
    xhr.responseType = "blob";

    if (options.onProgress) {
      xhr.addEventListener("progress", (evt) => {
        if (!evt.lengthComputable) return;
        options.onProgress?.({
          loaded: evt.loaded,
          total: evt.total,
          fraction: Math.min(1, evt.loaded / evt.total),
        });
      });
    }

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
        /* already aborted */
      }
    };
    if (options.signal) {
      if (options.signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    xhr.onload = () => {
      options.signal?.removeEventListener("abort", onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        const blob = xhr.response as Blob;
        const fallback = path.split("/").pop() || "download";
        const filename = parseFilename(xhr.getResponseHeader("Content-Disposition"), fallback);
        try {
          saveBlob(blob, filename);
        } catch (err) {
          reject(
            err instanceof Error ? err : new FileApiError(0, "Failed to save downloaded file"),
          );
          return;
        }
        resolve({ filename, bytes: blob.size });
      } else {
        // Server may have returned a JSON error body, but with
        // responseType=blob we can't read it as JSON directly. Surface
        // the HTTP status so the caller's toast says something useful.
        reject(new FileApiError(xhr.status, `Download failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => {
      options.signal?.removeEventListener("abort", onAbort);
      reject(new FileApiError(0, "Network error during download"));
    };

    xhr.onabort = () => {
      options.signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };

    xhr.send();
  });
}
