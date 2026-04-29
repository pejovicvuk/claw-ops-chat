"use client";

import { ChatWindow } from "./windows/chat-window";
import { PreviewWindow } from "./windows/preview-window";
import type { WindowDescriptor, WindowState } from "./canvas-types";

interface WindowHostProps {
  descriptor: WindowDescriptor;
  onSessionCreated: (id: string, claudeSessionId: string) => void;
  /** Optional in-window state mutation (e.g. preview port edits). */
  onStateChange?: (id: string, patch: Partial<WindowState>) => void;
}

/**
 * Dispatches a `WindowDescriptor` to the right body component based on
 * `descriptor.state.kind`. Adding a new window kind = adding a new arm
 * here + a corresponding component under `./windows/`.
 */
export function WindowHost({ descriptor, onSessionCreated, onStateChange }: WindowHostProps) {
  if (descriptor.state.kind === "chat") {
    return (
      <ChatWindow
        descriptor={descriptor}
        onSessionCreated={(claudeSessionId) => onSessionCreated(descriptor.id, claudeSessionId)}
      />
    );
  }
  if (descriptor.state.kind === "preview") {
    return (
      <PreviewWindow
        descriptor={descriptor}
        onPortChange={(port) => onStateChange?.(descriptor.id, { kind: "preview", port })}
      />
    );
  }
  return null;
}
