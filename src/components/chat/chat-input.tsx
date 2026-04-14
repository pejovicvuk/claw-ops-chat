"use client";

import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import { FiSend } from "react-icons/fi";
import type { ClaudeStatus } from "@/lib/types";

interface ChatInputProps {
  status: ClaudeStatus;
  onSend: (text: string) => void;
  fileButton?: ReactNode;
}

export function ChatInput({ status, onSend, fileButton }: ChatInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = text.trim().length > 0 && status === "idle";

  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(text);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [canSend, text, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  return (
    <div
      className="shrink-0 px-3 py-2"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 8px)" }}
    >
      <div className="flex items-end gap-1.5 rounded-2xl border border-canvas-border/50 px-2 py-1">
        {fileButton}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            status === "idle"
              ? "Message Claude..."
              : status === "connecting"
                ? "Connecting..."
                : "Disconnected"
          }
          disabled={status === "disconnected" || status === "connecting"}
          rows={1}
          className="flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-normal text-canvas-fg placeholder:text-canvas-muted/60 focus:outline-none disabled:opacity-50"
          style={{ fontSize: "16px" }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1f6feb] text-white transition-opacity disabled:opacity-20"
        >
          <FiSend size={15} />
        </button>
      </div>
    </div>
  );
}
