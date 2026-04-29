"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUrlState } from "@/lib/use-url-state";
import { fetchItems, type ItemMeta } from "@/lib/items-api";
import { loadCanvasOrEmpty, saveCanvas } from "@/lib/canvas/canvas-store";
import { nextSpawnGeometry, pageCount } from "@/lib/canvas/auto-position";
import {
  canvasStorageKey,
  emptyCanvasState,
  type CanvasState,
  type WindowDescriptor,
  type WindowGeometry,
  type WindowKind,
} from "./canvas-types";
import { CanvasToolbar } from "./canvas-toolbar";
import { CanvasPage } from "./canvas-page";
import { ItemContext } from "./item-context";
import type { ItemContextValue } from "./item-context";

interface ItemCanvasProps {
  projectSlug: string;
  itemSlug: string;
  onOpenSessions?: () => void;
}

/**
 * Top-level orchestrator for the per-item workspace. Loads the canvas
 * blob from localStorage, owns all state mutations, persists every
 * change. Resolves the item's `absolutePath` over the items API and
 * makes it available to children via `ItemContext`.
 *
 * Window-kind specifics live in `WindowHost` + `./windows/*` so this
 * file stays type-agnostic.
 */
export function ItemCanvas({ projectSlug, itemSlug, onOpenSessions }: ItemCanvasProps) {
  const { setParam } = useUrlState();
  const storageKey = useMemo(
    () => canvasStorageKey(projectSlug, itemSlug),
    [projectSlug, itemSlug],
  );

  const [state, setState] = useState<CanvasState>(() => emptyCanvasState());
  const [hydrated, setHydrated] = useState(false);
  const [item, setItem] = useState<ItemMeta | null>(null);
  const [missing, setMissing] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage once on mount; persist on every state change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial hydration from localStorage; can't run during render (SSR)
    setState(loadCanvasOrEmpty(storageKey));
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    saveCanvas(storageKey, state);
  }, [hydrated, state, storageKey]);

  // Resolve the item's metadata so we can pass `absolutePath` down.
  useEffect(() => {
    let cancelled = false;
    fetchItems(projectSlug)
      .then(({ items }) => {
        if (cancelled) return;
        const match = items.find((i) => i.slug === itemSlug);
        if (!match) setMissing(true);
        else setItem(match);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [itemSlug, projectSlug]);

  const handleBack = useCallback(() => {
    setParam("item", null);
  }, [setParam]);

  const updateGeometry = useCallback(
    (id: string, geometry: WindowGeometry, prev?: WindowGeometry) => {
      setState((current) => ({
        ...current,
        windows: current.windows.map((win) =>
          win.id === id
            ? {
                ...win,
                geometry,
                prevGeometry: prev !== undefined ? prev : win.prevGeometry,
              }
            : win,
        ),
      }));
    },
    [],
  );

  const bringToFront = useCallback((id: string) => {
    setState((current) => {
      if (current.focusOrder[0] === id) return current;
      const rest = current.focusOrder.filter((wid) => wid !== id);
      return { ...current, focusOrder: [id, ...rest] };
    });
  }, []);

  const closeWindow = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      windows: current.windows.filter((w) => w.id !== id),
      focusOrder: current.focusOrder.filter((wid) => wid !== id),
    }));
  }, []);

  const addWindow = useCallback((kind: WindowKind) => {
    const el = pageRef.current;
    const viewport = el
      ? { width: el.clientWidth, height: el.clientHeight }
      : { width: 1024, height: 700 };
    setState((current) => {
      const { page, geometry } = nextSpawnGeometry(current, viewport);
      const id = makeWindowId();
      const sessionId = `new-${id}`;
      // Currently every kind maps to a chat session — but the switch is
      // here so the next kind drops in without restructuring this block.
      const winState =
        kind === "chat"
          ? ({ kind: "chat", sessionId } as const)
          : ({ kind: "chat", sessionId } as const);
      const descriptor: WindowDescriptor = { id, page, geometry, state: winState };
      return {
        ...current,
        windows: [...current.windows, descriptor],
        focusOrder: [id, ...current.focusOrder],
        currentPage: page,
      };
    });
  }, []);

  const setPage = useCallback((page: number) => {
    setState((current) => {
      const max = Math.max(0, pageCount(current) - 1);
      const clamped = Math.min(Math.max(0, page), max);
      if (clamped === current.currentPage) return current;
      return { ...current, currentPage: clamped };
    });
  }, []);

  const handleSessionCreated = useCallback((id: string, claudeSessionId: string) => {
    setState((current) => ({
      ...current,
      windows: current.windows.map((win) =>
        win.id === id && win.state.kind === "chat"
          ? { ...win, state: { kind: "chat", sessionId: claudeSessionId } }
          : win,
      ),
    }));
  }, []);

  const totalPages = pageCount(state);
  const currentPageWindows = useMemo(
    () => state.windows.filter((w) => w.page === state.currentPage),
    [state.currentPage, state.windows],
  );

  const itemContextValue = useMemo<ItemContextValue | null>(() => {
    if (!item) return null;
    return {
      projectSlug,
      itemSlug,
      absolutePath: item.absolutePath,
      displayName: item.displayName,
    };
  }, [item, itemSlug, projectSlug]);

  if (missing) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-canvas-bg">
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
      </div>
    );
  }

  return (
    <ItemContext.Provider value={itemContextValue}>
      <div className="flex min-h-0 flex-1 flex-col bg-canvas-bg">
        <CanvasToolbar
          itemDisplayName={item?.displayName ?? itemSlug}
          itemSlug={itemSlug}
          currentPage={state.currentPage}
          totalPages={totalPages}
          onBack={handleBack}
          onPageChange={setPage}
          onAdd={addWindow}
          onOpenSessions={onOpenSessions}
        />
        <div ref={pageRef} className="relative flex min-h-0 flex-1 flex-col">
          <CanvasPage
            windows={currentPageWindows}
            focusOrder={state.focusOrder}
            onChange={updateGeometry}
            onClose={closeWindow}
            onFocus={bringToFront}
            onSessionCreated={handleSessionCreated}
          />
        </div>
      </div>
    </ItemContext.Provider>
  );
}

function makeWindowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older runtimes — good enough for a per-tab UI handle.
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
