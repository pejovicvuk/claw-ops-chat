"use client";

import { FileApiError } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

export interface UploadOptions {
  /** Progress callback, 0..1. Only emitted while upload bytes are flowing. */
  onProgress?: (fraction: number) => void;
  /** Abort signal to cancel mid-upload. */
  signal?: AbortSignal;
  /**
   * Optional path (relative to `dirPath`) where the file should land. Used by
   * folder uploads — e.g. `"src/lib/foo.ts"` drops the file into
   * `<dirPath>/src/lib/foo.ts`, creating the parent dirs server-side. When
   * omitted the file lands directly under `dirPath` using its sanitized name.
   */
  relativePath?: string;
}

export interface UploadResponse {
  path: string;
  overwritten?: boolean;
}

/**
 * Upload a file via XHR so we can emit progress events (fetch doesn't
 * expose them as of 2026). Same auth story as authFetch — relies on the
 * httpOnly session cookie which the browser sends automatically.
 *
 * Does NOT perform the silent re-auth retry that authFetch does, because
 * XHR doesn't round-trip a replayable request cleanly. Callers should
 * kick a cookie refresh via any authFetch call before retrying if they
 * see 401.
 */
export function uploadFileXhr(
  dirPath: string,
  file: File,
  options: UploadOptions = {},
): Promise<UploadResponse> {
  return new Promise<UploadResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${BASE}/api/files/upload?path=${encodeURIComponent(dirPath)}`;

    xhr.open("POST", url, true);
    xhr.withCredentials = true;
    xhr.responseType = "text";

    if (options.onProgress) {
      xhr.upload.addEventListener("progress", (evt) => {
        if (!evt.lengthComputable) return;
        options.onProgress?.(Math.min(1, evt.loaded / evt.total));
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
      let body: { path?: string; overwritten?: boolean; error?: string; code?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON — fall through with empty body */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ path: body.path ?? "", overwritten: body.overwritten });
      } else {
        reject(
          new FileApiError(xhr.status, body.error || `Upload failed (${xhr.status})`, body.code),
        );
      }
    };

    xhr.onerror = () => {
      options.signal?.removeEventListener("abort", onAbort);
      reject(new FileApiError(0, "Network error during upload"));
    };

    xhr.onabort = () => {
      options.signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };

    const formData = new FormData();
    formData.append("file", file);
    if (options.relativePath) {
      formData.append("relativePath", options.relativePath);
    }
    xhr.send(formData);
  });
}
