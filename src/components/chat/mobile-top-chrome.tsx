"use client";

import { FiMenu, FiPlus, FiFolder } from "react-icons/fi";
import type { ActiveToolInfo, ClaudeStatus } from "@/lib/types";
import type { ContextUsage } from "@/lib/use-claude-chat";
import { Z_INDEX } from "@/lib/z-index";
import { ModelThinkingPicker } from "./composer/model-thinking-picker";
import { HeaderIndicators } from "./header-indicators";

interface MobileTopChromeProps {
  onOpenSessions: () => void;
  onOpenFiles: () => void;
  onNewChat: () => void;
  status: ClaudeStatus;
  activeTool: ActiveToolInfo | null;
  reconnect: () => void;
  model: string | null;
  setModel: (next: string | null) => void;
  effort: string | null;
  setEffort: (next: string | null) => void;
  contextUsage: ContextUsage | null;
}

/**
 * Mobile-only floating chrome that replaces the slim utility bar.
 *
 * Layout (left → right), all `position: fixed` so the chat scrolls
 * BENEATH them with a `.scroll-fade-top` blur scrim mediating
 * legibility against the iOS status bar:
 *
 *   [☰]   {Model ▾ / Effort + status·rings}   [📁] [+]
 *
 * - `[☰]` = sessions glass bubble.
 * - The center stack is the existing `<ModelThinkingPicker variant="top" />`
 *   with the existing `<HeaderIndicators />` cluster directly below — same
 *   popovers and rate-limit polling, just relocated.
 * - `[📁]` = files glass bubble.
 * - `[+]` = new-chat — accent-filled badge so it reads as the primary
 *   create action, mirroring the Anthropic iOS app.
 *
 * The companion `.scroll-fade-top` overlay is rendered separately by
 * the parent `<ChatView />` (kept outside this component so the same
 * scrim remains in place during the brief render window when this
 * cluster is being repositioned, e.g. on rotation).
 */
export function MobileTopChrome({
  onOpenSessions,
  onOpenFiles,
  onNewChat,
  status,
  activeTool,
  reconnect,
  model,
  setModel,
  effort,
  setEffort,
  contextUsage,
}: MobileTopChromeProps) {
  return (
    <div
      className="fixed left-0 right-0 flex items-start justify-between gap-2 px-3"
      style={{
        top: "max(env(safe-area-inset-top, 0px), 8px)",
        zIndex: Z_INDEX.HEADER,
      }}
    >
      <button
        type="button"
        onClick={onOpenSessions}
        aria-label="Open conversations"
        className="lg-bubble btn-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-canvas-fg"
      >
        <FiMenu size={16} />
      </button>

      <div className="flex min-w-0 flex-col items-center gap-1 pt-0.5">
        <ModelThinkingPicker
          variant="top"
          model={model}
          setModel={setModel}
          effort={effort}
          setEffort={setEffort}
          contextUsage={contextUsage}
        />
        <HeaderIndicators status={status} activeTool={activeTool} reconnect={reconnect} />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenFiles}
          aria-label="Open files"
          className="lg-bubble btn-press flex h-10 w-10 items-center justify-center rounded-full text-canvas-fg"
        >
          <FiFolder size={16} />
        </button>
        <button
          type="button"
          onClick={onNewChat}
          aria-label="New chat"
          className="btn-press flex h-10 w-10 items-center justify-center rounded-full text-white shadow-lg"
          style={{ backgroundColor: "var(--accent)" }}
        >
          <FiPlus size={18} />
        </button>
      </div>
    </div>
  );
}
