"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileApiError } from "@/lib/api";
import { downloadFileWithProgress } from "@/lib/download-xhr";

export interface DownloadProgress {
  path: string;
  filename: string;
  loaded: number;
  total: number;
  fraction: number;
  controller: AbortController;
}

export interface UseDownloadResult {
  download: (path: string) => void;
  progress: DownloadProgress | null;
  abort: () => void;
}

function basename(path: string): string {
  return path.split("/").pop() || "download";
}

function mapError(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") return "Download cancelled";
  if (err instanceof FileApiError) {
    if (err.status === 401) return "Still signing you back in — try again in a moment.";
    if (err.status === 403) return "Access denied for this file.";
    if (err.status === 404) return "File not found.";
    return err.message;
  }
  return "Network error — check your connection.";
}

/**
 * Owns one in-flight download per consumer. Multiple components can
 * each call `useDownload()` and have their own progress; the underlying
 * XHR is per-call so concurrent downloads from different surfaces don't
 * step on each other.
 */
export function useDownload(opts?: { onError?: (msg: string) => void }): UseDownloadResult {
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const onErrorRef = useRef(opts?.onError);
  useEffect(() => {
    onErrorRef.current = opts?.onError;
  }, [opts?.onError]);

  const download = useCallback((path: string) => {
    const controller = new AbortController();
    const filename = basename(path);
    setProgress({
      path,
      filename,
      loaded: 0,
      total: 0,
      fraction: 0,
      controller,
    });

    downloadFileWithProgress(path, {
      signal: controller.signal,
      onProgress: (e) => {
        setProgress((prev) =>
          prev && prev.path === path
            ? { ...prev, loaded: e.loaded, total: e.total, fraction: e.fraction }
            : prev,
        );
      },
    })
      .then(() => {
        setProgress((prev) => (prev && prev.path === path ? null : prev));
      })
      .catch((err: unknown) => {
        setProgress((prev) => (prev && prev.path === path ? null : prev));
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        if (!isAbort) onErrorRef.current?.(mapError(err));
      });
  }, []);

  const abort = useCallback(() => {
    setProgress((prev) => {
      prev?.controller.abort();
      return null;
    });
  }, []);

  return { download, progress, abort };
}
