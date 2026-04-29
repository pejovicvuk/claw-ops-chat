"use client";

import { useCallback, useContext } from "react";
import { ChatView } from "@/components/chat/chat-view";
import { ItemContext } from "../item-context";
import type { WindowDescriptor } from "../canvas-types";

interface ChatWindowProps {
  descriptor: WindowDescriptor;
  onSessionCreated: (claudeSessionId: string) => void;
}

/**
 * Embeds `ChatView` inside the canvas. The chat starts at the item's
 * absolute path (no `~/projects/...` resolution required client-side —
 * the items API already returns the resolved path on `ItemMeta`).
 *
 *   - sessionId        sticks to the descriptor for the lifetime of
 *                      the window (so reload resumes the chat).
 *   - resumeSessionId  null while the session is "new-...", then set
 *                      to the real claudeSessionId once `onSessionCreated`
 *                      fires.
 *   - defaultCwd       seed for new chats; ChatView upgrades to the
 *                      persisted cwd on subsequent loads.
 */
export function ChatWindow({ descriptor, onSessionCreated }: ChatWindowProps) {
  const item = useContext(ItemContext);
  const handleCreated = useCallback(
    (claudeSessionId: string) => {
      onSessionCreated(claudeSessionId);
    },
    [onSessionCreated],
  );
  if (descriptor.state.kind !== "chat") return null;
  const sessionId = descriptor.state.sessionId;
  const isNew = sessionId.startsWith("new-");

  return (
    <ChatView
      sessionId={sessionId}
      resumeSessionId={isNew ? null : sessionId}
      headerless
      onSessionCreated={handleCreated}
      defaultCwd={item?.absolutePath ?? null}
    />
  );
}
