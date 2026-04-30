"use client";

import { FiMessageSquare, FiMonitor } from "react-icons/fi";
import type { WindowDescriptor } from "./canvas-types";

interface WindowTabsProps {
  /** Minimized descriptors on the current page only. */
  windows: WindowDescriptor[];
  onRestore: (id: string) => void;
}

/**
 * Auto-fit tab strip for minimized windows, rendered inside the canvas
 * toolbar. Each tab grows to share the available space (`flex-1`) and
 * caps at `MAX_TAB_W` so a single tab can't hog the toolbar. Titles
 * truncate with ellipsis when space is tight. Click a tab to restore.
 */
export function WindowTabs({ windows, onRestore }: WindowTabsProps) {
  if (windows.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {windows.map((win) => (
        <button
          key={win.id}
          type="button"
          onClick={() => onRestore(win.id)}
          className="btn-press inline-flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-canvas-border bg-canvas-surface px-2 text-[11px] font-medium text-canvas-fg hover:bg-canvas-surface-hover"
          style={{ maxWidth: MAX_TAB_W }}
          title={titleFor(win)}
        >
          <KindIcon win={win} />
          <span className="min-w-0 flex-1 truncate text-left">{titleFor(win)}</span>
        </button>
      ))}
    </div>
  );
}

const MAX_TAB_W = 180;

function KindIcon({ win }: { win: WindowDescriptor }) {
  if (win.state.kind === "chat") return <FiMessageSquare size={11} className="shrink-0" />;
  if (win.state.kind === "preview") return <FiMonitor size={11} className="shrink-0" />;
  return null;
}

function titleFor(win: WindowDescriptor): string {
  if (win.state.kind === "chat") {
    if (win.state.sessionId.startsWith("new-")) return "New chat";
    return `Chat ${win.state.sessionId.slice(0, 8)}`;
  }
  if (win.state.kind === "preview") return `Preview · :${win.state.port}`;
  return win.id.slice(0, 8);
}
