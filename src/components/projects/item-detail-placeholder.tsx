"use client";

import { useCallback, useEffect, useState } from "react";
import { FiArrowLeft } from "react-icons/fi";
import { useUrlState } from "@/lib/use-url-state";
import { fetchItems, type ItemMeta } from "@/lib/items-api";
import { ItemIcon } from "./item-card";

interface ItemDetailPlaceholderProps {
  projectSlug: string;
  itemSlug: string;
  projectDisplayName: string | null;
  onOpenSessions?: () => void;
}

/**
 * Placeholder per-item view. Shows the path on disk + a "coming soon"
 * note for the eventual Claude-session-with-cwd flow. Lives in the same
 * main pane as the project dashboard so the back arrow returns there.
 */
export function ItemDetailPlaceholder({
  projectSlug,
  itemSlug,
  projectDisplayName,
  onOpenSessions,
}: ItemDetailPlaceholderProps) {
  const { setParam } = useUrlState();
  const [item, setItem] = useState<ItemMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prop→state sync: reset on slug change
    setLoading(true);
    setMissing(false);
    fetchItems(projectSlug)
      .then(({ items }) => {
        if (cancelled) return;
        const match = items.find((i) => i.slug === itemSlug);
        if (!match) setMissing(true);
        else setItem(match);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectSlug, itemSlug]);

  const handleBack = useCallback(() => {
    setParam("item", null);
  }, [setParam]);

  const path = `~/projects/${projectSlug}/${itemSlug}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas-bg">
      <header className="flex shrink-0 items-center gap-2 border-b border-canvas-border px-4 py-3">
        {onOpenSessions && (
          <button
            type="button"
            onClick={onOpenSessions}
            className="btn-press flex h-9 w-9 items-center justify-center rounded-lg text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg md:hidden"
            aria-label="Open sidebar"
          >
            <FiArrowLeft size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={handleBack}
          className="btn-press flex h-9 w-9 items-center justify-center rounded-lg text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          aria-label="Back to project"
          title={projectDisplayName ?? "Back"}
        >
          <FiArrowLeft size={16} />
        </button>
        <h1 className="line-clamp-1 text-[15px] font-semibold text-canvas-fg">
          {item?.displayName ?? itemSlug}
        </h1>
        {item && (
          <span className="rounded-full bg-canvas-surface-hover px-2 py-0.5 font-mono text-[10px] text-canvas-muted">
            {item.kind}
          </span>
        )}
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        {missing ? (
          <div className="text-center">
            <p className="text-[14px] font-medium text-canvas-fg">Item not found</p>
            <p className="mt-1 text-[12px] text-canvas-muted">
              The folder for <span className="font-mono">{itemSlug}</span> no longer exists.
            </p>
            <button
              type="button"
              onClick={handleBack}
              className="btn-press mt-4 rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
            >
              Back to project
            </button>
          </div>
        ) : loading && !item ? (
          <p className="text-[12px] text-canvas-muted">Loading item…</p>
        ) : (
          <div className="mx-auto flex max-w-md flex-col items-center text-center">
            <div
              className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ backgroundColor: "var(--canvas-surface-hover)" }}
            >
              <ItemIcon kind={item?.kind ?? "folder"} size={22} />
            </div>
            <h2 className="text-[15px] font-semibold text-canvas-fg">{item?.displayName}</h2>
            <p className="mt-3 text-[12px] text-canvas-muted">Path on this device</p>
            <code className="mt-1 rounded-md bg-canvas-surface-hover px-2 py-1 font-mono text-[12px] text-canvas-fg">
              {path}
            </code>
            {item?.repoUrl && (
              <>
                <p className="mt-3 text-[12px] text-canvas-muted">Source</p>
                <code className="mt-1 line-clamp-1 max-w-full rounded-md bg-canvas-surface-hover px-2 py-1 font-mono text-[12px] text-canvas-fg">
                  {item.repoUrl}
                </code>
              </>
            )}
            <p className="mt-5 text-[13px] leading-relaxed text-canvas-muted">
              Open in Claude — coming soon. Per-item Claude sessions will start their working
              directory here so the agent only sees this folder.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
