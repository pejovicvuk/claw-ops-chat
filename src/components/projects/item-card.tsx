"use client";

import { FiFolder, FiTrash2 } from "react-icons/fi";
import { SiGithub, SiBitbucket } from "react-icons/si";
import { formatRelativeTime } from "@/lib/format-time";
import type { ItemMeta } from "@/lib/items-api";

interface ItemCardProps {
  item: ItemMeta;
  onOpen: () => void;
  onDelete: () => void;
}

export function ItemCard({ item, onOpen, onDelete }: ItemCardProps) {
  return (
    <article className="group relative rounded-xl border border-canvas-border bg-canvas-bg p-3 shadow-sm transition-colors hover:bg-canvas-surface-hover">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 text-left"
        aria-label={`Open item ${item.displayName}`}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: "var(--canvas-surface-hover)" }}
        >
          <ItemIcon kind={item.kind} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-1 text-[14px] font-semibold text-canvas-fg">
            {item.displayName}
          </h3>
          <p className="mt-0.5 line-clamp-1 text-[11px] text-canvas-muted">{captionFor(item)}</p>
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="btn-press absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted opacity-0 transition-opacity hover:bg-canvas-bg hover:text-red-500 group-hover:opacity-100 focus:opacity-100"
        aria-label={`Delete item ${item.displayName}`}
        title="Delete item"
      >
        <FiTrash2 size={13} />
      </button>
    </article>
  );
}

export function ItemIcon({
  kind,
  size = 14,
  className = "text-canvas-muted",
}: {
  kind: ItemMeta["kind"];
  size?: number;
  className?: string;
}) {
  if (kind === "github") return <SiGithub size={size} className={className} />;
  if (kind === "bitbucket") return <SiBitbucket size={size} className={className} />;
  return <FiFolder size={size} className={className} />;
}

function captionFor(item: ItemMeta): string {
  const created = `created ${formatRelativeTime(item.createdAt)}`;
  if (item.kind === "folder") {
    const count =
      item.itemCount === 0
        ? "empty"
        : `${item.itemCount} ${item.itemCount === 1 ? "item" : "items"}`;
    return `Folder · ${count} · ${created}`;
  }
  const label = item.kind === "github" ? "GitHub" : "Bitbucket";
  const ownerRepo = item.repoUrl ? extractOwnerRepo(item.repoUrl) : item.slug;
  return `${label} · ${ownerRepo} · ${created}`;
}

function extractOwnerRepo(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length < 2) return url;
    const repo = segs[1].endsWith(".git") ? segs[1].slice(0, -4) : segs[1];
    return `${segs[0]}/${repo}`;
  } catch {
    return url;
  }
}
