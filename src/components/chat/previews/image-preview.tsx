"use client";

import { useMemo, useState } from "react";
import { FiImage } from "react-icons/fi";
import { useLightbox } from "@/lib/use-lightbox";
import { isLikelyLocalPath } from "@/lib/detect-file-paths";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface ImagePreviewProps {
  src: string;
  alt?: string;
  /** When true, renders at full width with larger max-height (for "Read an image" tool result). */
  large?: boolean;
}

function resolveSrc(raw: string): string {
  if (!raw) return "";
  if (raw.startsWith("blob:") || raw.startsWith("data:")) return raw;
  if (raw.startsWith("/chat/api/")) return raw;
  if (isLikelyLocalPath(raw)) {
    return `${BASE}/api/files/serve?path=${encodeURIComponent(raw)}`;
  }
  if (/^https?:\/\//i.test(raw)) {
    return `${BASE}/api/proxy/image?url=${encodeURIComponent(raw)}`;
  }
  // Fallback: treat as local relative path anchored at home.
  return `${BASE}/api/files/serve?path=${encodeURIComponent(raw)}`;
}

export function ImagePreview({ src, alt, large }: ImagePreviewProps) {
  const resolved = useMemo(() => resolveSrc(src), [src]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const { open } = useLightbox();

  if (status === "error") {
    return (
      <span className="my-2 inline-flex items-center gap-1.5 rounded-md border border-canvas-border bg-canvas-surface-hover px-2 py-1 text-[11px] text-canvas-muted">
        <FiImage size={11} />
        Couldn&rsquo;t load image{alt ? ` · ${alt}` : ""}
      </span>
    );
  }

  const sizeClass = large ? "max-h-[480px] w-full max-w-2xl" : "max-h-64 max-w-full";

  return (
    <button
      type="button"
      onClick={() => open({ src: resolved, alt })}
      className={`${sizeClass} my-2 block overflow-hidden rounded-lg border border-canvas-border bg-canvas-surface-hover cursor-zoom-in`}
    >
      {status === "loading" && (
        <div className={`${sizeClass} animate-pulse bg-canvas-bg`} aria-hidden="true" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolved}
        alt={alt ?? ""}
        loading="lazy"
        decoding="async"
        onLoad={() => setStatus("ok")}
        onError={() => setStatus("error")}
        className={`${sizeClass} block object-contain ${status === "loading" ? "hidden" : ""}`}
      />
    </button>
  );
}
