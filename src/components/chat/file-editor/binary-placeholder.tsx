"use client";

import { useEffect, useState } from "react";
import { FiDownload, FiFile } from "react-icons/fi";
import { downloadFile } from "@/lib/api";
import { authFetch } from "@/lib/auth";
import type { FileEntry } from "@/lib/types";
import { FileIcon } from "../file-browser/file-icon";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);

export function isBinaryPath(path: string): boolean {
  const base = path.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;
  const ext = base.slice(dot + 1).toLowerCase();
  return BINARY_EXTS.has(ext);
}

const BINARY_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "bmp",
  "ico",
  "avif",
  "mp3",
  "wav",
  "ogg",
  "flac",
  "m4a",
  "mp4",
  "webm",
  "mov",
  "mkv",
  "zip",
  "tar",
  "gz",
  "tgz",
  "7z",
  "rar",
  "bz2",
  "xz",
  "pdf",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "class",
  "jar",
  "wasm",
]);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

interface BinaryPlaceholderProps {
  file: FileEntry;
  /** Optional download handler — when provided, used instead of the
   *  built-in `downloadFile()` so callers can hook in progress UI. */
  onDownload?: () => void;
}

export function BinaryPlaceholder({ file, onDownload }: BinaryPlaceholderProps) {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const isImage = IMAGE_EXT.has(ext);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    let revoked: string | null = null;
    (async () => {
      try {
        const res = await authFetch(
          `${BASE}/api/files/download?path=${encodeURIComponent(file.path)}`,
        );
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        revoked = url;
        setImgUrl(url);
      } catch (err) {
        setImgError(err instanceof Error ? err.message : "Preview failed");
      }
    })();
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [file.path, isImage]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      {isImage && imgUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob URL preview, Next/image doesn't help
        <img
          src={imgUrl}
          alt={file.name}
          className="max-h-full max-w-full rounded border border-canvas-border object-contain"
        />
      ) : isImage && !imgError ? (
        <div className="flex items-center gap-2 text-[12px] text-canvas-muted">
          Loading preview…
        </div>
      ) : (
        <>
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-canvas-surface">
            <FileIcon entry={file} size={24} />
          </span>
          <div>
            <p className="text-[13px] font-medium text-canvas-fg">{file.name}</p>
            <p className="text-[11px] text-canvas-muted">
              Binary file · {formatSize(file.size)} · not editable
            </p>
          </div>
        </>
      )}

      {imgError && (
        <p className="flex items-center gap-1 text-[11px] text-red-400">
          <FiFile size={11} />
          {imgError}
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          if (onDownload) {
            onDownload();
          } else {
            downloadFile(file.path).catch(() => {
              /* surfaced via toast at the caller */
            });
          }
        }}
        className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90"
      >
        <FiDownload size={11} />
        Download
      </button>
    </div>
  );
}
