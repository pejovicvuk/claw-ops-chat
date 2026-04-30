"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiMessageSquare } from "react-icons/fi";
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
  type WindowState,
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

  // Lock the global file browser to this item's folder while the canvas
  // is mounted. ChatLayout reads `?root` + `?path` and forwards them to
  // the FileBrowser, which enforces the boundary in `navigateTo`.
  const itemAbsolutePath = item?.absolutePath ?? null;
  useEffect(() => {
    if (!itemAbsolutePath) return;
    setParam("root", itemAbsolutePath);
    setParam("path", itemAbsolutePath);
    return () => {
      setParam("root", null);
      setParam("path", null);
    };
  }, [itemAbsolutePath, setParam]);

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
      const winState: WindowState =
        kind === "chat"
          ? { kind: "chat", sessionId: `new-${id}` }
          : { kind: "preview", port: 3000 };
      const descriptor: WindowDescriptor = { id, page, geometry, state: winState };
      return {
        ...current,
        windows: [...current.windows, descriptor],
        focusOrder: [id, ...current.focusOrder],
        currentPage: page,
      };
    });
  }, []);

  /**
   * Restore a minimized window. Lifted from CanvasPage because the tab
   * strip that triggers it now lives in CanvasToolbar (a sibling of
   * CanvasPage), so the handler has to sit at the parent level.
   */
  const restoreWindow = useCallback((id: string) => {
    setState((current) => {
      const target = current.windows.find((w) => w.id === id);
      if (!target) return current;
      const rest = current.focusOrder.filter((wid) => wid !== id);
      return {
        ...current,
        windows: current.windows.map((win) =>
          win.id === id ? { ...win, geometry: { ...win.geometry, minimized: false } } : win,
        ),
        focusOrder: [id, ...rest],
      };
    });
  }, []);

  /**
   * Patch an individual window's `state` (e.g. preview port edit).
   * Mirrors the `updateGeometry` shape — partial merge on the matching
   * window's discriminated-union state, leaving the rest untouched.
   */
  const updateState = useCallback((id: string, patch: Partial<WindowState>) => {
    setState((current) => ({
      ...current,
      windows: current.windows.map((win) => {
        if (win.id !== id) return win;
        // Discriminated-union merge: keep the existing kind unless the
        // patch explicitly switches it. The cast is safe because the
        // caller is expected to pass a same-kind patch.
        const merged = { ...win.state, ...patch } as WindowState;
        return { ...win, state: merged };
      }),
    }));
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

  const handleAddChat = useCallback(() => addWindow("chat"), [addWindow]);

  const totalPages = pageCount(state);
  const currentPageWindows = useMemo(
    () => state.windows.filter((w) => w.page === state.currentPage),
    [state.currentPage, state.windows],
  );
  const minimizedWindows = useMemo(
    () => currentPageWindows.filter((w) => w.geometry.minimized === true),
    [currentPageWindows],
  );
  const isPageEmpty = currentPageWindows.length === 0;

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
          minimizedWindows={minimizedWindows}
          onBack={handleBack}
          onPageChange={setPage}
          onAdd={addWindow}
          onRestoreWindow={restoreWindow}
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
            onStateChange={updateState}
          />
          {isPageEmpty && hydrated && <EmptyState onAddChat={handleAddChat} />}
        </div>
      </div>
    </ItemContext.Provider>
  );
}

/**
 * Empty-state placeholder rendered when the active page has zero
 * windows. Sits above the dot-grid canvas and below the snap overlay
 * (z-irrelevant since neither is interactive when the canvas is empty).
 * The CTA reuses the `addWindow("chat")` callback so spawn placement
 * goes through the same `nextSpawnGeometry` path as the toolbar button.
 */
function EmptyState({ onAddChat }: { onAddChat: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-canvas-border bg-canvas-surface px-6 py-8 text-center shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-canvas-bg text-canvas-muted">
          <FiMessageSquare size={20} />
        </div>
        <div className="space-y-1">
          <h2 className="text-[15px] font-semibold text-canvas-fg">Start a chat</h2>
          <p className="text-[12px] leading-snug text-canvas-muted">
            Open a chat window to start working on this project. You can drag, resize, and snap
            windows side-by-side.
          </p>
        </div>
        <button
          type="button"
          onClick={onAddChat}
          className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
        >
          <FiMessageSquare size={13} />
          Open a chat
        </button>
      </div>
    </div>
  );
}

function makeWindowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older runtimes — good enough for a per-tab UI handle.
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
