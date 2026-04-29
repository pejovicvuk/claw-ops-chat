"use client";

import { FiMessageSquare, FiMonitor } from "react-icons/fi";
import { DOCK_H, type WindowDescriptor } from "./canvas-types";

interface DockStripProps {
  /** Minimized descriptors on the current page only. */
  windows: WindowDescriptor[];
  onRestore: (id: string) => void;
}

/**
 * Bottom strip of pills, one per minimized window on the current page.
 * Click a pill to restore. Hidden entirely when no windows are
 * minimized (so the canvas reclaims that vertical space).
 */
export function DockStrip({ windows, onRestore }: DockStripProps) {
  if (windows.length === 0) return null;
  return (
    <div
      className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 overflow-x-auto border-t border-canvas-border bg-canvas-surface px-2"
      style={{ height: DOCK_H }}
    >
      {windows.map((win) => (
        <button
          key={win.id}
          type="button"
          onClick={() => onRestore(win.id)}
          className="btn-press inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-canvas-border bg-canvas-bg px-2.5 text-[11px] font-medium text-canvas-fg hover:bg-canvas-surface-hover"
          title={titleFor(win)}
        >
          <KindIcon win={win} />
          <span className="line-clamp-1 max-w-[180px]">{titleFor(win)}</span>
        </button>
      ))}
    </div>
  );
}

function KindIcon({ win }: { win: WindowDescriptor }) {
  if (win.state.kind === "chat") return <FiMessageSquare size={11} />;
  if (win.state.kind === "preview") return <FiMonitor size={11} />;
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
