"use client";

import type { ReactNode } from "react";
import { FiGlobe } from "react-icons/fi";
import { useUnfurl } from "@/lib/use-unfurl";

interface LinkPreviewProps {
  href: string;
  children: ReactNode;
  /** When true, skips the unfurl fetch and renders the plain inline link only. */
  inlineOnly?: boolean;
  /** When true, renders ONLY the card (no inline link above). Used for WebSearch results. */
  cardOnly?: boolean;
}

/**
 * Wraps an `<a>` link and lazy-fetches an unfurl card that renders
 * below it. Card shows favicon + site name + title + 2-line description
 * + optional 72×72 thumbnail.
 *
 * Failure is silent — if the unfurl fetch fails, the inline link still works.
 */
export function LinkPreview({ href, children, inlineOnly, cardOnly }: LinkPreviewProps) {
  const unfurl = useUnfurl(href, !inlineOnly);

  const inlineLink = (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline break-words"
    >
      {children}
    </a>
  );

  if (inlineOnly) return inlineLink;

  let card: ReactNode = null;
  if (unfurl.status === "loading") {
    card = <UnfurlSkeleton href={href} />;
  } else if (unfurl.status === "ok") {
    card = <UnfurlCard data={unfurl.data} href={href} />;
  }

  if (cardOnly) {
    return card ?? inlineLink;
  }

  return (
    <>
      {inlineLink}
      {card}
    </>
  );
}

function hostnameOf(href: string): string {
  try {
    return new URL(href).hostname;
  } catch {
    return href;
  }
}

function UnfurlSkeleton({ href }: { href: string }) {
  return (
    <span
      aria-hidden="true"
      className="my-2 flex max-w-xl items-start gap-3 rounded-lg border border-canvas-border bg-canvas-surface-hover px-3 py-2.5 opacity-70"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-canvas-muted">
        <FiGlobe size={13} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="h-[11px] w-24 animate-pulse rounded bg-canvas-bg" />
        <span className="h-[13px] w-4/5 animate-pulse rounded bg-canvas-bg" />
        <span className="h-[12px] w-full animate-pulse rounded bg-canvas-bg" />
      </span>
      <span className="sr-only">Loading preview of {hostnameOf(href)}</span>
    </span>
  );
}

function UnfurlCard({
  data,
  href,
}: {
  data: {
    title: string | null;
    description: string | null;
    imageUrl: string | null;
    siteName: string | null;
    favicon: string | null;
  };
  href: string;
}) {
  const host = hostnameOf(href);
  const title = data.title || host;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="my-2 flex max-w-xl items-start gap-3 rounded-lg border border-canvas-border bg-canvas-surface px-3 py-2.5 no-underline transition-colors hover:bg-canvas-surface-hover"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px] text-canvas-muted">
          <Favicon src={data.favicon} host={host} />
          <span className="truncate">{data.siteName || host}</span>
        </div>
        <div className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug text-canvas-fg">
          {title}
        </div>
        {data.description && (
          <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-canvas-muted">
            {data.description}
          </div>
        )}
      </div>
      {data.imageUrl && (
        <div className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-md bg-canvas-bg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={(e) => {
              // Hide the slot if the image 404s — keeps card layout clean.
              (e.currentTarget.parentElement as HTMLElement).style.display = "none";
            }}
          />
        </div>
      )}
    </a>
  );
}

function Favicon({ src, host }: { src: string | null; host: string }) {
  if (!src) {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-canvas-muted">
        <FiGlobe size={11} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-label={host}
      width={16}
      height={16}
      className="h-4 w-4 shrink-0 rounded-sm"
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}
