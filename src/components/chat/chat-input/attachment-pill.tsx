"use client";

import { FiAlertTriangle, FiFile, FiLoader, FiX } from "react-icons/fi";

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
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);

export function isImageName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXT.has(name.slice(dot + 1).toLowerCase());
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Preview card for a file attached to the composer. Renders as a
 * roughly-square tile:
 *
 * ```
 * ┌──────────┐
 * │ [thumb]  │  ← image fills this area (object-cover) or large icon
 * │          │
 * ├──────────┤
 * │ name.png │
 * │ 42% · K  │  ← status: percent while uploading, size when done
 * └──────────┘
 * ```
 *
 * The × button is overlaid on the top-right of the thumbnail so it's
 * always visible even when the attachment is a photo with the same
 * background tone as the card.
 */
export function AttachmentPill({ attachment, onRemove }: AttachmentPillProps) {
  const { id, name, size, previewUrl, uploadedPath, progress, error } = attachment;
  const isImage = !!previewUrl && isImageName(name);
  const uploading = !uploadedPath && !error;
  const pct = Math.round(progress * 100);

  const borderClass = error
    ? "border-red-500/50"
    : uploadedPath
      ? "border-canvas-border"
      : "border-canvas-border";

  return (
    <div
      className={`group relative flex h-[112px] w-[112px] shrink-0 flex-col overflow-hidden rounded-xl border ${borderClass} bg-canvas-bg shadow-sm transition-shadow duration-150 hover:shadow-md`}
    >
      {/* Thumbnail area — ~72 px tall, fills card width. */}
      <div className="relative h-[72px] w-full shrink-0 overflow-hidden bg-canvas-surface">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {error ? (
              <FiAlertTriangle size={28} className="text-red-400" />
            ) : (
              <FiFile size={28} className="text-canvas-muted" />
            )}
          </div>
        )}

        {/* Upload-progress fill along the top edge of the thumbnail. */}
        {uploading && (
          <div className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-black/10 backdrop-blur-sm">
            <div
              className="h-full bg-accent transition-[width] duration-100"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        {/* Uploading spinner overlay for non-image tiles (images have the
            bar at the top which is enough of a hint). */}
        {uploading && !isImage && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <FiLoader size={14} className="animate-spin text-accent" />
          </div>
        )}
      </div>

      {/* × remove button — overlays the top-right of the thumbnail. Visible
          always (no fade-on-hover) so mobile users don't have to guess. */}
      <button
        type="button"
        onClick={() => onRemove(id)}
        aria-label={`Remove ${name}`}
        className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white shadow transition-transform duration-100 hover:scale-110 hover:bg-black/80"
      >
        <FiX size={11} strokeWidth={2.5} />
      </button>

      {/* Footer — filename + status / size. */}
      <div className="flex min-h-0 flex-1 flex-col justify-center px-2 py-1.5">
        <span className="truncate text-[11px] leading-tight text-canvas-fg" title={name}>
          {name}
        </span>
        <span
          className={`mt-0.5 truncate text-[10px] leading-tight ${
            error ? "text-red-400" : "text-canvas-muted"
          }`}
          title={error ?? undefined}
        >
          {error ? error : uploading ? `${pct}%` : formatSize(size)}
        </span>
      </div>
    </div>
  );
}
