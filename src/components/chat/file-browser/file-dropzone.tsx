"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FiDownload, FiWifiOff } from "react-icons/fi";
import type { UploadEntry } from "@/lib/batch-upload";

interface FileDropzoneProps {
  onUpload: (entries: UploadEntry[]) => Promise<void> | void;
  disabled?: boolean;
  children: React.ReactNode;
  /** Pass through className to the outer wrapper. */
  className?: string;
}

type DragState = "idle" | "accepting";

// ──────────────────────────────────────────────────────────────────
// Directory traversal
// ──────────────────────────────────────────────────────────────────

interface FileSystemEntryLike {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => FileSystemDirectoryReaderLike;
}

interface FileSystemDirectoryReaderLike {
  readEntries: (cb: (entries: FileSystemEntryLike[]) => void, err?: (e: unknown) => void) => void;
}

/** Promise wrapper around the callback-style `FileSystemFileEntry.file`. */
function entryToFile(entry: FileSystemEntryLike): Promise<File | null> {
  return new Promise((resolve) => {
    if (!entry.file) return resolve(null);
    entry.file(
      (f) => resolve(f),
      () => resolve(null),
    );
  });
}

/**
 * Drain a directory reader. `readEntries` returns at most 100 entries per
 * call — the empty-result sentinel means "done" — so we loop until we see
 * one.
 */
function readAllEntries(reader: FileSystemDirectoryReaderLike): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve) => {
    const out: FileSystemEntryLike[] = [];
    const drain = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) return resolve(out);
          for (const e of batch) out.push(e);
          drain();
        },
        () => resolve(out),
      );
    };
    drain();
  });
}

/**
 * Recursively flatten a `FileSystemEntry` into a list of `{file, relativePath}`
 * entries suitable for `uploadBatch`. The root entry's name becomes the first
 * path segment so the original folder shape is preserved on the server.
 */
async function walkEntry(entry: FileSystemEntryLike, prefix: string): Promise<UploadEntry[]> {
  const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await entryToFile(entry);
    if (!file) return [];
    return [{ file, relativePath: relPath }];
  }
  if (entry.isDirectory && entry.createReader) {
    const children = await readAllEntries(entry.createReader());
    const results: UploadEntry[] = [];
    for (const child of children) {
      const sub = await walkEntry(child, relPath);
      for (const u of sub) results.push(u);
    }
    return results;
  }
  return [];
}

/** True if the drag payload is a file (vs. a text/HTML/etc drag). */
function payloadIsFileDrag(dt: DataTransfer): boolean {
  if (!dt.types) return false;
  for (let i = 0; i < dt.types.length; i++) {
    if (dt.types[i] === "Files") return true;
  }
  return false;
}

// ──────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────

export function FileDropzone({ onUpload, disabled, children, className }: FileDropzoneProps) {
  const [drag, setDrag] = useState<DragState>("idle");
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const dragCounter = useRef(0);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, []);

  /**
   * Coalesce dragover's 60×/s firing into one state update per frame.
   * Folders are now accepted — the only reject path left is "not a file
   * drag at all" (text, HTML, URLs, etc.), which we treat as idle.
   */
  const reconcile = useCallback((dt: DataTransfer) => {
    if (rafId.current !== null) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      const next: DragState = payloadIsFileDrag(dt) ? "accepting" : "idle";
      setDrag((prev) => (prev === next ? prev : next));
    });
  }, []);

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      dragCounter.current += 1;
      reconcile(e.dataTransfer);
    },
    [disabled, reconcile],
  );

  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        if (rafId.current !== null) {
          cancelAnimationFrame(rafId.current);
          rafId.current = null;
        }
        setDrag("idle");
      }
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      reconcile(e.dataTransfer);
      e.dataTransfer.dropEffect = online ? "copy" : "none";
    },
    [disabled, online, reconcile],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      const wasAccepting = drag === "accepting";
      setDrag("idle");
      if (disabled || !wasAccepting || !online) return;

      const entries: UploadEntry[] = [];

      // Prefer `webkitGetAsEntry` — it's the only way to detect dropped
      // folders and walk into them. Fall back to the flat `files` list if
      // the browser doesn't support the entry API (Safari versions, some
      // mobile browsers).
      const items = e.dataTransfer.items;
      if (items && items.length > 0) {
        const roots: FileSystemEntryLike[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind !== "file") continue;
          const getAs = (item as unknown as { webkitGetAsEntry?: () => FileSystemEntryLike | null })
            .webkitGetAsEntry;
          let entry: FileSystemEntryLike | null = null;
          if (typeof getAs === "function") {
            try {
              entry = getAs.call(item);
            } catch {
              entry = null;
            }
          }
          if (entry) {
            roots.push(entry);
          } else {
            // No entry API — fall back to the DataTransferItem's file.
            const f = item.getAsFile();
            if (f) entries.push({ file: f, relativePath: f.name });
          }
        }
        for (const root of roots) {
          const walked = await walkEntry(root, "");
          for (const u of walked) entries.push(u);
        }
      } else {
        // Legacy `files` list path (no entry API at all).
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          const f = e.dataTransfer.files[i];
          entries.push({ file: f, relativePath: f.name });
        }
      }

      if (entries.length === 0) return;
      await onUpload(entries);
    },
    [drag, disabled, onUpload, online],
  );

  return (
    <div
      className={`relative ${className ?? ""}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children}
      {drag !== "idle" && (
        <div
          className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md border-2 border-dashed backdrop-blur-sm ${
            !online ? "border-canvas-muted bg-canvas-bg/80" : "border-accent bg-accent/25"
          }`}
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-3 text-center">
            {!online ? (
              <>
                <FiWifiOff size={32} className="text-canvas-muted" />
                <p className="text-[14px] font-semibold text-canvas-fg">You&apos;re offline</p>
                <p className="text-[11px] text-canvas-muted">
                  Files can&apos;t be uploaded right now.
                </p>
              </>
            ) : (
              <>
                <FiDownload size={36} className="text-accent" />
                <p className="text-[15px] font-semibold text-canvas-fg">Drop to upload</p>
                <p className="text-[11px] text-canvas-muted">Files or folders</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
