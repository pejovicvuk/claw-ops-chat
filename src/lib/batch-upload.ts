"use client";

import { uploadFile } from "@/lib/api";

/**
 * Upload orchestrator for multi-file / folder drops.
 *
 * - Runs sequentially so the aggregate progress number is honest (one large
 *   file doesn't make 100 tiny ones look like they're lagging).
 * - Partial failures are recorded and surfaced in the result; the batch
 *   keeps going so a single bad file doesn't sink the rest of the folder.
 * - Abort signal cancels the current XHR and skips remaining entries.
 */

export interface UploadEntry {
  file: File;
  /**
   * Path relative to the target directory, slash-joined. For a flat file
   * drop this is just the file name; for a folder `src` dropped in, entries
   * look like `"src/foo.ts"`, `"src/lib/bar.ts"`, etc.
   */
  relativePath: string;
}

export interface BatchProgress {
  /** Bytes finished across completed files. */
  completedBytes: number;
  /** Sum of `file.size` across every entry. */
  totalBytes: number;
  /** Smoothed fraction (0..1) = (completedBytes + currentFraction * currentSize) / totalBytes. */
  fraction: number;
  /** Relative path of the file currently being uploaded (for UI labels). */
  currentFile: string;
  /** 1-indexed position of the current file in the batch. */
  currentIndex: number;
  /** Total number of files in the batch. */
  total: number;
}

export interface BatchFailure {
  relativePath: string;
  error: string;
}

export interface BatchResult {
  succeeded: number;
  failed: BatchFailure[];
  /** True when the caller aborted before all entries finished. */
  aborted: boolean;
}

export interface UploadBatchOptions {
  signal: AbortSignal;
  onProgress: (p: BatchProgress) => void;
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function uploadBatch(
  basePath: string,
  entries: UploadEntry[],
  opts: UploadBatchOptions,
): Promise<BatchResult> {
  const totalBytes = entries.reduce((acc, e) => acc + e.file.size, 0);
  const total = entries.length;
  const failed: BatchFailure[] = [];
  let completedBytes = 0;
  let succeeded = 0;

  for (let i = 0; i < entries.length; i++) {
    if (opts.signal.aborted) {
      return { succeeded, failed, aborted: true };
    }
    const entry = entries[i];

    // Emit a starting-at-0 progress tick so the UI updates the current-file
    // label even for zero-byte files (where no upload.progress event fires).
    opts.onProgress({
      completedBytes,
      totalBytes,
      fraction: totalBytes === 0 ? 1 : completedBytes / totalBytes,
      currentFile: entry.relativePath,
      currentIndex: i + 1,
      total,
    });

    try {
      await uploadFile(basePath, entry.file, {
        relativePath: entry.relativePath,
        signal: opts.signal,
        onProgress: (frac) => {
          const ticker = completedBytes + frac * entry.file.size;
          opts.onProgress({
            completedBytes,
            totalBytes,
            fraction: totalBytes === 0 ? 1 : ticker / totalBytes,
            currentFile: entry.relativePath,
            currentIndex: i + 1,
            total,
          });
        },
      });
      completedBytes += entry.file.size;
      succeeded += 1;
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        return { succeeded, failed, aborted: true };
      }
      failed.push({ relativePath: entry.relativePath, error: errMessage(err) });
      // Skip the bytes for the failed file; the fraction jumps, but this is
      // more accurate than pretending it completed.
      completedBytes += entry.file.size;
    }

    opts.onProgress({
      completedBytes,
      totalBytes,
      fraction: totalBytes === 0 ? 1 : completedBytes / totalBytes,
      currentFile: entry.relativePath,
      currentIndex: i + 1,
      total,
    });
  }

  return { succeeded, failed, aborted: false };
}
