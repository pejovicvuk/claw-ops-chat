"use client";

import { useCallback, useMemo } from "react";
import {
  FiDownload,
  FiEye,
  FiFile,
  FiFileText,
  FiCode,
  FiImage,
  FiVideo,
  FiMusic,
  FiArchive,
} from "react-icons/fi";
import { formatBytes, isImageExt, prettyMimeLabel } from "@/lib/mime";
import { useFileStat } from "@/lib/use-file-stat";
import { ImagePreview } from "./image-preview";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface FileCardProps {
  path: string;
}

type CardKind = "image" | "pdf" | "video" | "audio" | "generic";

const PDF_EXT = /\.pdf$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|m4v)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;
const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|sh|bash|zsh|rb|java|kt|swift|cpp?|hpp?|cs|sql)$/i;
const TEXT_EXT = /\.(md|mdx|txt|log|json|yaml|yml|csv|html?|xml|toml|env|conf|ini)$/i;
const ARCHIVE_EXT = /\.(zip|tar|gz|tgz|7z|rar|bz2|xz)$/i;

function classify(path: string): CardKind {
  if (isImageExt(path)) return "image";
  if (PDF_EXT.test(path)) return "pdf";
  if (VIDEO_EXT.test(path)) return "video";
  if (AUDIO_EXT.test(path)) return "audio";
  return "generic";
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function relativeTime(mtime: number): string {
  if (!mtime) return "";
  const diff = Date.now() - mtime;
  if (diff < 0) return "just now";
  if (diff < 60_000) return "just now";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))}h ago`;
  if (diff < 30 * 24 * 60 * 60_000) return `${Math.floor(diff / (24 * 60 * 60_000))}d ago`;
  return new Date(mtime).toISOString().slice(0, 10);
}

function iconFor(path: string, kind: CardKind) {
  if (kind === "image") return FiImage;
  if (kind === "video") return FiVideo;
  if (kind === "audio") return FiMusic;
  if (ARCHIVE_EXT.test(path)) return FiArchive;
  if (CODE_EXT.test(path)) return FiCode;
  if (TEXT_EXT.test(path) || PDF_EXT.test(path)) return FiFileText;
  return FiFile;
}

function openInEditor(path: string): void {
  try {
    const url = new URL(window.location.href);
    const current = url.searchParams.getAll("open");
    if (!current.includes(path)) url.searchParams.append("open", path);
    url.searchParams.set("active", path);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    /* ignore */
  }
}

export function FileCard({ path }: FileCardProps) {
  const kind = classify(path);
  const name = useMemo(() => basename(path), [path]);
  const { stat } = useFileStat(path);

  // Images reuse ImagePreview (which already handles lightbox). Wrap in
  // the same card chrome so the footer (size + Download) is consistent.
  if (kind === "image") {
    return (
      <div className="my-2 max-w-xl overflow-hidden rounded-lg border border-canvas-border bg-canvas-surface">
        <ImagePreview src={path} alt={name} large />
        <CardFooter path={path} name={name} stat={stat} showPreviewButton={false} />
      </div>
    );
  }

  if (kind === "pdf") {
    return (
      <div className="my-2 max-w-xl overflow-hidden rounded-lg border border-canvas-border bg-canvas-surface">
        <iframe
          src={`${BASE}/api/files/serve?path=${encodeURIComponent(path)}#toolbar=0`}
          title={name}
          loading="lazy"
          className="block h-[480px] w-full bg-canvas-bg"
        />
        <CardFooter
          path={path}
          name={name}
          stat={stat}
          showPreviewButton
          previewLabel="Open full"
          onPreview={() => openInEditor(path)}
        />
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className="my-2 max-w-xl overflow-hidden rounded-lg border border-canvas-border bg-canvas-surface">
        <video
          controls
          preload="metadata"
          src={`${BASE}/api/files/serve?path=${encodeURIComponent(path)}`}
          className="block max-h-[480px] w-full bg-black"
        >
          Your browser doesn&rsquo;t support video playback.
        </video>
        <CardFooter path={path} name={name} stat={stat} showPreviewButton={false} />
      </div>
    );
  }

  if (kind === "audio") {
    return (
      <div className="my-2 flex max-w-xl flex-col gap-2 rounded-lg border border-canvas-border bg-canvas-surface px-3 py-2.5">
        <CardHeader path={path} name={name} stat={stat} kind={kind} />
        <audio
          controls
          preload="metadata"
          src={`${BASE}/api/files/serve?path=${encodeURIComponent(path)}`}
          className="w-full"
        >
          Your browser doesn&rsquo;t support audio playback.
        </audio>
        <CardActions path={path} name={name} showPreviewButton={false} />
      </div>
    );
  }

  // Generic — compact card with [Preview] [Download] buttons.
  return (
    <div className="my-2 flex max-w-xl flex-col gap-2 rounded-lg border border-canvas-border bg-canvas-surface px-3 py-2.5">
      <CardHeader path={path} name={name} stat={stat} kind={kind} />
      <CardActions path={path} name={name} showPreviewButton onPreview={() => openInEditor(path)} />
    </div>
  );
}

/* ── Internals ─────────────────────────────────────────────────────── */

function CardHeader({
  path,
  name,
  stat,
  kind,
}: {
  path: string;
  name: string;
  stat: ReturnType<typeof useFileStat>["stat"];
  kind: CardKind;
}) {
  const Icon = iconFor(path, kind);
  const typeLabel = prettyMimeLabel(path);
  const sizeLabel = stat?.exists ? formatBytes(stat.size) : "";
  const timeLabel = stat?.exists ? relativeTime(stat.mtime) : "";
  const bits = [typeLabel, sizeLabel, timeLabel ? `modified ${timeLabel}` : ""].filter(Boolean);

  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-canvas-surface-hover text-canvas-fg">
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-canvas-fg" title={path}>
          {name}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-canvas-muted">
          {stat === null ? (
            <span className="inline-block h-[11px] w-24 animate-pulse rounded bg-canvas-bg align-middle" />
          ) : stat.exists ? (
            bits.join(" · ")
          ) : (
            "missing or outside workspace"
          )}
        </div>
      </div>
    </div>
  );
}

function CardFooter({
  path,
  name,
  stat,
  showPreviewButton,
  previewLabel = "Preview",
  onPreview,
}: {
  path: string;
  name: string;
  stat: ReturnType<typeof useFileStat>["stat"];
  showPreviewButton: boolean;
  previewLabel?: string;
  onPreview?: () => void;
}) {
  const sizeLabel = stat?.exists ? formatBytes(stat.size) : "";
  const typeLabel = prettyMimeLabel(path);
  return (
    <div className="flex items-center justify-between gap-2 border-t border-canvas-border bg-canvas-bg/30 px-3 py-2">
      <div className="min-w-0 text-[11px] text-canvas-muted">
        <span className="truncate font-medium text-canvas-fg" title={name}>
          {name}
        </span>
        <span className="ml-1.5">
          {typeLabel}
          {sizeLabel ? ` · ${sizeLabel}` : ""}
        </span>
      </div>
      <div className="flex shrink-0 gap-1.5">
        {showPreviewButton && onPreview && (
          <button
            type="button"
            onClick={onPreview}
            className="inline-flex items-center gap-1 rounded-md border border-canvas-border bg-canvas-surface px-2 py-1 text-[11px] text-canvas-fg transition-colors hover:bg-canvas-surface-hover"
          >
            <FiEye size={11} />
            {previewLabel}
          </button>
        )}
        <DownloadLink path={path} name={name} />
      </div>
    </div>
  );
}

function CardActions({
  path,
  name,
  showPreviewButton,
  onPreview,
}: {
  path: string;
  name: string;
  showPreviewButton: boolean;
  onPreview?: () => void;
}) {
  return (
    <div className="flex shrink-0 gap-1.5">
      {showPreviewButton && onPreview && (
        <button
          type="button"
          onClick={onPreview}
          className="inline-flex min-h-[32px] flex-1 items-center justify-center gap-1.5 rounded-md border border-canvas-border bg-canvas-surface px-3 py-1.5 text-[12px] font-medium text-canvas-fg transition-colors hover:bg-canvas-surface-hover"
        >
          <FiEye size={12} />
          Preview
        </button>
      )}
      <DownloadLink path={path} name={name} large />
    </div>
  );
}

function DownloadLink({ path, name, large }: { path: string; name: string; large?: boolean }) {
  const href = `${BASE}/api/files/download?path=${encodeURIComponent(path)}`;
  const onClick = useCallback(() => {
    // Anchor with download attribute handles everything — we just keep
    // the click from propagating so an ancestor <button> doesn't trigger.
  }, []);
  return (
    <a
      href={href}
      download={name}
      onClick={onClick}
      title={`Download ${name}`}
      className={
        large
          ? "inline-flex min-h-[32px] flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white no-underline transition-colors hover:opacity-90"
          : "inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white no-underline transition-colors hover:opacity-90"
      }
    >
      <FiDownload size={large ? 12 : 11} />
      Download
    </a>
  );
}
