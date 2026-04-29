"use client";

import { ChatWindow } from "./windows/chat-window";
import type { WindowDescriptor } from "./canvas-types";

interface WindowHostProps {
  descriptor: WindowDescriptor;
  onSessionCreated: (id: string, claudeSessionId: string) => void;
}

/**
 * Dispatches a `WindowDescriptor` to the right body component based on
 * `descriptor.state.kind`. Adding a new window kind = adding a new arm
 * here + a corresponding component under `./windows/`.
 */
export function WindowHost({ descriptor, onSessionCreated }: WindowHostProps) {
  if (descriptor.state.kind === "chat") {
    return (
      <ChatWindow
        descriptor={descriptor}
        onSessionCreated={(claudeSessionId) => onSessionCreated(descriptor.id, claudeSessionId)}
      />
    );
  }
  return null;
}
