"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FiAlertTriangle, FiDownload, FiWifiOff } from "react-icons/fi";

interface FileDropzoneProps {
  onUpload: (files: File[]) => Promise<void> | void;
  disabled?: boolean;
  children: React.ReactNode;
  /** Pass through className to the outer wrapper. */
  className?: string;
}

type DragState = "idle" | "accepting" | "rejecting";

/**
 * Detect whether a drag payload includes any directory entries.
 *
 * `DataTransferItem.webkitGetAsEntry` is standardized but some browsers
 * (notably Firefox on Linux) leave `items` empty during `dragenter`,
 * populating it only on `dragover` or `drop`. Callers should re-check
 * on every dragover so the overlay reflects reality as soon as the
 * browser tells us.
 */
function payloadIncludesDirectory(dt: DataTransfer): boolean {
  if (!dt.items || dt.items.length === 0) return false;
  for (let i = 0; i < dt.items.length; i++) {
    const item = dt.items[i];
    if (item.kind !== "file") continue;
    const getAs = (item as unknown as { webkitGetAsEntry?: () => { isDirectory: boolean } | null })
      .webkitGetAsEntry;
    if (typeof getAs !== "function") continue;
    let entry: { isDirectory: boolean } | null = null;
    try {
      entry = getAs.call(item);
    } catch {
      /* some browsers throw on cross-origin items — treat as unknown */
    }
    if (entry?.isDirectory) return true;
  }
  return false;
}

/** True if the drag payload is a file (vs. a text/HTML/etc drag). */
function payloadIsFileDrag(dt: DataTransfer): boolean {
  if (!dt.types) return false;
  for (let i = 0; i < dt.types.length; i++) {
    if (dt.types[i] === "Files") return true;
  }
  return false;
}

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
   * Resolve the current drag state from the DataTransfer and schedule a
   * re-render only if the value changed. rAF-coalesced to keep dragover
   * (which fires 60×/s) from thrashing React.
   */
  const reconcile = useCallback((dt: DataTransfer) => {
    if (rafId.current !== null) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      if (!payloadIsFileDrag(dt)) {
        setDrag((prev) => (prev === "idle" ? prev : "idle"));
        return;
      }
      const next: DragState = payloadIncludesDirectory(dt) ? "rejecting" : "accepting";
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
      // Always re-check — dragenter may have fired before items were
      // populated (Firefox/Linux) so the first answer can be wrong.
      reconcile(e.dataTransfer);
      e.dataTransfer.dropEffect = drag === "rejecting" || !online ? "none" : "copy";
    },
    [disabled, drag, online, reconcile],
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

      // Reject the entire drop if any item is a directory — partial
      // uploads confuse more than they help.
      if (payloadIncludesDirectory(e.dataTransfer)) return;

      const files: File[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        // Defensive: skip anything masquerading as a folder (size 0 + no
        // extension + empty MIME). The server enforces this too.
        if (file.size === 0 && file.type === "" && !file.name.includes(".")) continue;
        files.push(file);
      }
      if (files.length === 0) return;
      await onUpload(files);
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
          className={`pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed backdrop-blur-[2px] ${
            drag === "rejecting"
              ? "border-red-400 bg-red-500/15"
              : !online
                ? "border-canvas-muted bg-canvas-bg/80"
                : "border-accent bg-accent/10"
          }`}
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-2 text-center text-[12px]">
            {drag === "rejecting" ? (
              <>
                <FiAlertTriangle size={22} className="text-red-400" />
                <p className="font-medium text-red-400">Folders aren&apos;t supported</p>
                <p className="text-[11px] text-canvas-muted">Drag individual files only.</p>
              </>
            ) : !online ? (
              <>
                <FiWifiOff size={22} className="text-canvas-muted" />
                <p className="font-medium text-canvas-fg">You&apos;re offline</p>
                <p className="text-[11px] text-canvas-muted">
                  Files can&apos;t be uploaded right now.
                </p>
              </>
            ) : (
              <>
                <FiDownload size={22} className="text-accent" />
                <p className="font-medium text-canvas-fg">Drop to upload</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
