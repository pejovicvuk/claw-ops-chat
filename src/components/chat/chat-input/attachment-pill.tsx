"use client";

import { FiAlertTriangle, FiFile, FiX, FiLoader } from "react-icons/fi";

export interface AttachmentPillData {
  id: string;
  name: string;
  size: number;
  /** Blob URL for images — shown as a thumbnail before upload finishes. */
  previewUrl?: string;
  /** Server path after upload, e.g. `~/uploads/<ts>-foo.png`. */
  uploadedPath?: string;
  /** 0..1 — only meaningful while `uploadedPath` is missing. */
  progress: number;
  error?: string;
}

interface AttachmentPillProps {
  attachment: AttachmentPillData;
  onRemove: (id: string) => void;
  onRetry?: (id: string) => void;
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);

export function isImageName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXT.has(name.slice(dot + 1).toLowerCase());
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} K`;
  return `${(bytes / 1024 / 1024).toFixed(1)} M`;
}

export function AttachmentPill({ attachment, onRemove, onRetry }: AttachmentPillProps) {
  const { id, name, size, previewUrl, uploadedPath, progress, error } = attachment;
  const isImage = !!previewUrl && isImageName(name);
  const uploading = !uploadedPath && !error;
  const pct = Math.round(progress * 100);

  return (
    <div
      className={`group relative flex h-11 min-w-0 max-w-[180px] shrink-0 items-center gap-2 rounded-xl border px-2 text-[11px] ${
        error
          ? "border-red-500/30 bg-red-500/10"
          : uploadedPath
            ? "border-canvas-border bg-canvas-surface/80"
            : "border-canvas-border bg-canvas-surface/50"
      }`}
    >
      {/* Thumbnail / icon */}
      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-canvas-bg">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : error ? (
          <FiAlertTriangle size={14} className="text-red-400" />
        ) : (
          <FiFile size={14} className="text-canvas-muted" />
        )}
        {uploading && !isImage && (
          <FiLoader size={10} className="absolute animate-spin text-accent" />
        )}
      </div>

      {/* Name + status */}
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-canvas-fg" title={name}>
          {name}
        </span>
        <span
          className={`truncate text-[10px] ${error ? "text-red-400" : "text-canvas-muted"}`}
          title={error ?? undefined}
        >
          {error ? error : uploading ? `${pct}%` : formatSize(size)}
        </span>
      </div>

      {/* Progress fill overlay (bottom bar) */}
      {uploading && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden rounded-b-xl bg-canvas-border">
          <div
            className="h-full bg-accent transition-[width] duration-100"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        {error && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(id)}
            className="text-[10px] text-blue-400 hover:underline"
            aria-label="Retry upload"
          >
            Retry
          </button>
        )}
        <button
          type="button"
          onClick={() => onRemove(id)}
          aria-label="Remove attachment"
          className="flex h-5 w-5 items-center justify-center rounded-full text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
        >
          <FiX size={11} />
        </button>
      </div>
    </div>
  );
}
