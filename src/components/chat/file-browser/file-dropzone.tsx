"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FiDownload, FiUploadCloud, FiWifiOff } from "react-icons/fi";
import type { UploadEntry } from "@/lib/batch-upload";

interface FileDropzoneProps {
  onUpload: (entries: UploadEntry[]) => Promise<void> | void;
  disabled?: boolean;
  children: React.ReactNode;
  /** Pass through className to the outer wrapper. */
  className?: string;
  /**
   * `"inline"` (default) — overlay fills the wrapper, used for in-panel
   * dropzones like the files browser and the composer box.
   *
   * `"panel"` — larger overlay sized for a whole pane (chat-view's center
   * column). Bigger icon + more descriptive copy, meant to be visible
   * across ~500 px of empty space.
   */
  size?: "inline" | "panel";
  /**
   * When set, this dropzone stays idle while another dropzone higher in
   * the tree is active. Prevents duplicate overlays when a child and
   * parent both wrap the drop region.
   *
   * The host owns the flag and toggles it via a shared DragGroup ref or
   * state; `FileDropzone` itself doesn't care how — it just honors
   * `suppressed`.
   */
  suppressed?: boolean;
  /**
   * Fires on dragenter (first real enter) and dragleave (final exit).
   * Used by parent dropzones to know when to suppress themselves.
   */
  onDragStateChange?: (active: boolean) => void;
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

function entryToFile(entry: FileSystemEntryLike): Promise<File | null> {
  return new Promise((resolve) => {
    if (!entry.file) return resolve(null);
    entry.file(
      (f) => resolve(f),
      () => resolve(null),
    );
  });
}

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

export function FileDropzone({
  onUpload,
  disabled,
  children,
  className,
  size = "inline",
  suppressed,
  onDragStateChange,
}: FileDropzoneProps) {
  const [drag, setDrag] = useState<DragState>("idle");
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  // Notify host when our drag state transitions. Debounced on the falling
  // edge via rAF to paper over the parent→child hover flicker without the
  // old enter/leave counter.
  const prevActiveRef = useRef(false);
  useEffect(() => {
    const active = drag === "accepting";
    if (active !== prevActiveRef.current) {
      prevActiveRef.current = active;
      onDragStateChange?.(active);
    }
  }, [drag, onDragStateChange]);

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled || suppressed) return;
      if (!payloadIsFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      setDrag("accepting");
    },
    [disabled, suppressed],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled || suppressed) return;
      if (!payloadIsFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      // Always keep `drag` active while the cursor is anywhere inside.
      // The previous version coalesced via rAF; with the relatedTarget
      // check below we no longer need that — dragover just preventDefaults
      // so the browser keeps forwarding events.
      setDrag((prev) => (prev === "accepting" ? prev : "accepting"));
      e.dataTransfer.dropEffect = online ? "copy" : "none";
    },
    [disabled, suppressed, online],
  );

  /**
   * `relatedTarget` is the element the cursor is entering. When it's still
   * inside our wrapper, the cursor only moved between children — keep
   * `drag` active. When it's outside (or null, which means "left the
   * window entirely"), flip to idle. This is the standard pattern used by
   * react-dropzone and every production file dropzone.
   */
  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (disabled || suppressed) return;
      const wrapper = wrapperRef.current;
      const next = e.relatedTarget as Node | null;
      if (wrapper && next && wrapper.contains(next)) return;
      setDrag("idle");
    },
    [disabled, suppressed],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      if (disabled || suppressed) return;
      e.preventDefault();
      const wasAccepting = drag === "accepting";
      setDrag("idle");
      if (!wasAccepting || !online) return;

      const entries: UploadEntry[] = [];
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
            const f = item.getAsFile();
            if (f) entries.push({ file: f, relativePath: f.name });
          }
        }
        for (const root of roots) {
          const walked = await walkEntry(root, "");
          for (const u of walked) entries.push(u);
        }
      } else {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          const f = e.dataTransfer.files[i];
          entries.push({ file: f, relativePath: f.name });
        }
      }
      if (entries.length === 0) return;
      await onUpload(entries);
    },
    [drag, disabled, suppressed, onUpload, online],
  );

  const showOverlay = drag === "accepting" && !suppressed;
  const isPanel = size === "panel";

  return (
    <div
      ref={wrapperRef}
      className={`relative ${className ?? ""}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      {showOverlay && (
        <div
          className={`pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed backdrop-blur-sm ${
            isPanel ? "rounded-none" : "rounded-xl"
          } ${!online ? "border-canvas-muted bg-canvas-bg/85" : "border-accent bg-accent/20"}`}
          aria-live="polite"
        >
          <div className={`flex flex-col items-center text-center ${isPanel ? "gap-4" : "gap-3"}`}>
            {!online ? (
              <>
                <FiWifiOff size={isPanel ? 48 : 32} className="text-canvas-muted" />
                <p
                  className={`font-semibold text-canvas-fg ${
                    isPanel ? "text-[18px]" : "text-[14px]"
                  }`}
                >
                  You&apos;re offline
                </p>
                <p className="text-[11px] text-canvas-muted">
                  Files can&apos;t be uploaded right now.
                </p>
              </>
            ) : (
              <>
                {isPanel ? (
                  <FiUploadCloud size={56} className="text-accent" />
                ) : (
                  <FiDownload size={36} className="text-accent" />
                )}
                <p
                  className={`font-semibold text-canvas-fg ${
                    isPanel ? "text-[20px]" : "text-[15px]"
                  }`}
                >
                  {isPanel ? "Drop to attach to message" : "Drop to upload"}
                </p>
                <p className={`text-canvas-muted ${isPanel ? "text-[12px]" : "text-[11px]"}`}>
                  Files or folders
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
