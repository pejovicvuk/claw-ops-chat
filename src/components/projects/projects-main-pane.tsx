"use client";

import { useCallback, useEffect, useState } from "react";
import { FiArrowLeft, FiMessageCircle } from "react-icons/fi";
import { useUrlState } from "@/lib/use-url-state";
import { fetchProjects, type ProjectMeta } from "@/lib/projects-api";
import { useItems } from "@/lib/use-items";
import { deleteItemApi, type ItemMeta } from "@/lib/items-api";
import { ProjectsDashboard } from "./projects-dashboard";
import { ItemsList } from "./items-list";
import { AddItemTray } from "./add-item-tray";
import { ItemCanvas } from "@/components/canvas/item-canvas";

interface ProjectsMainPaneProps {
  onOpenSessions?: () => void;
}

/**
 * Router for the main pane when `?view=projects`.
 *
 *   (no ?project)              → ProjectsDashboard (card grid + create flow)
 *   ?project=<slug>             → ProjectDetail (items list + add-item tray)
 *   ?project=<slug>&item=<slug> → ItemCanvas (per-item draggable window canvas)
 */
export function ProjectsMainPane({ onOpenSessions }: ProjectsMainPaneProps) {
  const { params } = useUrlState();
  const projectSlug = params.get("project");
  const itemSlug = params.get("item");

  if (!projectSlug) {
    return <ProjectsDashboard onOpenSessions={onOpenSessions} />;
  }
  return <ProjectDetail slug={projectSlug} itemSlug={itemSlug} onOpenSessions={onOpenSessions} />;
}

function ProjectDetail({
  slug,
  itemSlug,
  onOpenSessions,
}: {
  slug: string;
  itemSlug: string | null;
  onOpenSessions?: () => void;
}) {
  const { setParam } = useUrlState();
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const { items, loading: itemsLoading, refresh: refreshItems } = useItems(slug);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prop→state sync: reset loading/missing flags whenever slug changes
    setLoading(true);
    setMissing(false);
    fetchProjects()
      .then(({ projects }) => {
        if (cancelled) return;
        const match = projects.find((p) => p.slug === slug);
        if (!match) setMissing(true);
        else setProject(match);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleBack = useCallback(() => {
    setParam("project", null);
    setParam("item", null);
  }, [setParam]);

  const handleOpenItem = useCallback(
    (itemSlug: string) => {
      setParam("item", itemSlug);
    },
    [setParam],
  );

  const handleDeleteItem = useCallback(
    async (item: ItemMeta) => {
      if (
        !confirm(`Delete item "${item.displayName}"? The folder and its contents will be removed.`)
      ) {
        return;
      }
      try {
        await deleteItemApi(slug, item.slug);
        refreshItems();
      } catch (err) {
        alert(`Failed to delete: ${(err as Error).message}`);
      }
    },
    [refreshItems, slug],
  );

  const handleItemCreated = useCallback(() => {
    refreshItems();
  }, [refreshItems]);

  if (itemSlug) {
    return <ItemCanvas projectSlug={slug} itemSlug={itemSlug} onOpenSessions={onOpenSessions} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas-bg">
      <header className="pt-safe-top flex shrink-0 items-center gap-2 border-b border-canvas-border px-4 pb-3">
        {/* Mobile-only sessions toggle. Uses FiMessageCircle so it
            reads as "open sessions" rather than "back" — the back
            arrow was previously doing double-duty as the sidebar
            trigger, which was the source of the "icon says back but
            it opens sessions" confusion. */}
        {onOpenSessions && (
          <button
            type="button"
            onClick={onOpenSessions}
            className="btn-press flex h-9 w-9 items-center justify-center rounded-lg text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg md:hidden"
            aria-label="Open sessions"
          >
            <FiMessageCircle size={16} />
          </button>
        )}
        {/* Real back-to-projects button, visible on every viewport so
            mobile users have an in-app affordance for "leave this
            project" without relying on browser back. */}
        <button
          type="button"
          onClick={handleBack}
          className="btn-press flex h-9 w-9 items-center justify-center rounded-lg text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          aria-label="Back to projects"
          title="Back to projects"
        >
          <FiArrowLeft size={16} />
        </button>
        <h1 className="line-clamp-1 text-[15px] font-semibold text-canvas-fg">
          {project?.displayName ?? slug}
        </h1>
        {project && (
          <span className="rounded-full bg-canvas-surface-hover px-2 py-0.5 font-mono text-[10px] text-canvas-muted">
            {project.slug}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {missing ? (
          <ProjectMissing slug={slug} onBack={handleBack} />
        ) : loading && !project ? (
          <p className="py-12 text-center text-[12px] text-canvas-muted">Loading project…</p>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            <div>
              <h2 className="text-[13px] font-semibold text-canvas-fg">Items</h2>
              <p className="mt-0.5 text-[11px] text-canvas-muted">
                Each item is a folder under <span className="font-mono">~/projects/{slug}</span>.
              </p>
            </div>
            <AddItemTray projectSlug={slug} onCreated={handleItemCreated} />
            <ItemsList
              items={items}
              loading={itemsLoading}
              onOpen={handleOpenItem}
              onDelete={handleDeleteItem}
            />
            {!itemsLoading && items.length === 0 && (
              <p className="rounded-xl border border-dashed border-canvas-border px-4 py-8 text-center text-[12px] text-canvas-muted">
                No items yet. Click <span className="font-medium text-canvas-fg">Add item</span> to
                create a folder or import a repository.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectMissing({ slug, onBack }: { slug: string; onBack: () => void }) {
  return (
    <div className="py-12 text-center">
      <p className="text-[14px] font-medium text-canvas-fg">Project not found</p>
      <p className="mt-1 text-[12px] text-canvas-muted">
        The folder for <span className="font-mono">{slug}</span> no longer exists.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="btn-press mt-4 rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
      >
        Back to projects
      </button>
    </div>
  );
}
