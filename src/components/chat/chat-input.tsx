"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FiArrowUp, FiPaperclip, FiSquare } from "react-icons/fi";
import { useMentions } from "@/lib/use-mentions";
import type { ClaudeStatus } from "@/lib/types";
import { preloadMarkdown } from "./message-bubble";
import { AttachmentRow } from "./chat-input/attachment-row";
import type { AttachmentPillData } from "./chat-input/attachment-pill";
import { MentionPopover, type MentionPopoverHandle } from "./chat-input/mention-popover";

interface ChatInputProps {
  status: ClaudeStatus;
  onSend: (text: string) => void;
  onStop: () => void;
  /** External pre-fill (e.g. from empty-state suggestion chips). The
      effect re-runs on every `seq` bump so clicking the same suggestion
      twice still fills the composer; empty-string values are ignored so
      we don't wipe the user's in-progress draft. */
  initialText?: { text: string; seq: number };
  /** Lifted attachment state — owned by ChatView so drops on the whole
      chat pane feed the same list. */
  attachments: AttachmentPillData[];
  onAddFiles: (files: File[]) => void | Promise<void>;
  onRemoveAttachment: (id: string) => void;
  onClearAttachments: () => void;
}

/** Statuses where Claude is actively working and can be stopped. */
const ACTIVE_STATUSES = new Set<ClaudeStatus>([
  "thinking",
  "tool_running",
  "awaiting_permission",
  "awaiting_input",
]);

export function ChatInput({
  status,
  onSend,
  onStop,
  initialText,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  onClearAttachments,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<MentionPopoverHandle>(null);

  const mention = useMentions(text, caret);
  const popoverOpen =
    mention.open &&
    status !== "disconnected" &&
    status !== "connecting" &&
    mentionDismissed !== mention.rangeStart;

  const hasPendingUpload = attachments.some((a) => !a.uploadedPath && !a.error);
  const canSend =
    (text.trim().length > 0 || attachments.some((a) => a.uploadedPath)) &&
    status === "idle" &&
    !hasPendingUpload;
  const isActive = ACTIVE_STATUSES.has(status);
  // Pill stays in its "expanded" visual state whenever there's something
  // to send — typed text or any attachment (including ones still
  // uploading). Otherwise expansion falls back to CSS `:focus-within` so
  // the pill grows while the user is interacting with it.
  const hasContent = text.trim().length > 0 || attachments.length > 0;

  // Sync external pre-fills (suggestion chips) into the composer.
  const initialSeq = initialText?.seq ?? 0;
  useEffect(() => {
    if (!initialText || !initialText.text) return;
    setText(initialText.text);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
      el.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSeq]);

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      e.target.value = "";
      if (!list || list.length === 0) return;
      const files: File[] = [];
      for (let i = 0; i < list.length; i++) files.push(list[i]);
      await onAddFiles(files);
    },
    [onAddFiles],
  );

  const handleSend = useCallback(() => {
    if (!canSend) return;
    preloadMarkdown();
    const refs = attachments.filter((a) => a.uploadedPath).map((a) => `@${a.uploadedPath}`);
    const trimmed = text.trim();
    const final =
      refs.length > 0 ? (trimmed ? `${trimmed}\n\n${refs.join("\n")}` : refs.join("\n")) : text;
    onSend(final);
    onClearAttachments();
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [canSend, text, attachments, onSend, onClearAttachments]);

  /** Replace the active `@…` range with a completed token. */
  const handleAcceptMention = useCallback(
    (token: string, isDirectory: boolean) => {
      if (!mention.open) return;
      const before = text.slice(0, mention.rangeStart);
      const after = text.slice(mention.rangeEnd);
      const next = `${before}${token}${after}`;
      setText(next);
      const nextCaret = before.length + token.length;
      queueMicrotask(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.selectionStart = nextCaret;
        el.selectionEnd = nextCaret;
        setCaret(nextCaret);
        if (isDirectory) setMentionDismissed(null);
      });
    },
    [mention.open, mention.rangeStart, mention.rangeEnd, text],
  );

  const handleCloseMention = useCallback(() => {
    setMentionDismissed(mention.rangeStart);
  }, [mention.rangeStart]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (popoverOpen && popoverRef.current?.handleKeyDown(e)) {
        e.preventDefault();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, popoverOpen],
  );

  const syncCaret = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    setCaret(el.selectionStart ?? 0);
  }, []);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  const triggerFileInput = useCallback(() => {
    // Focus the textarea BEFORE opening the native picker so `:focus-within`
    // on the pill stays true while the file dialog is open. Without this,
    // Safari (where button clicks don't move focus) plus the focus the
    // dialog steals elsewhere can briefly collapse the pill mid-flow and
    // the user sees the composer shrink while they're picking a file.
    textareaRef.current?.focus();
    fileInputRef.current?.click();
  }, []);

  // Native textarea cancels external file drops by default. preventDefault
  // on dragover + drop lets the outer dropzone handle it. We do NOT handle
  // the drop here — just stop the browser's default so the event bubbles
  // to the panel-level FileDropzone in ChatView.
  const preventDefault = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div
      className="shrink-0 px-3 py-2"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 8px)" }}
    >
      <div
        className={`mx-auto ${
          hasContent ? "md:max-w-4xl" : "md:max-w-3xl md:focus-within:max-w-4xl"
        }`}
      >
        <div
          className={`glass-input flex flex-col rounded-2xl transition-all duration-300 ease-out ${
            hasContent
              ? "-translate-y-1 px-3 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.14)]"
              : "px-2.5 py-1.5 focus-within:-translate-y-1 focus-within:px-3 focus-within:py-2 focus-within:shadow-[0_12px_40px_rgba(0,0,0,0.14)]"
          }`}
        >
          <AttachmentRow attachments={attachments} onRemove={onRemoveAttachment} />

          <div className="flex items-end gap-1.5">
            <button
              type="button"
              onClick={triggerFileInput}
              aria-label="Attach files"
              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-canvas-muted transition-colors duration-150 hover:bg-canvas-surface-hover hover:text-canvas-fg"
              title="Attach files"
            >
              <FiPaperclip size={15} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileInput}
            />
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setCaret(e.target.selectionStart);
                setMentionDismissed(null);
                handleInput();
              }}
              onSelect={syncCaret}
              onClick={syncCaret}
              onKeyUp={syncCaret}
              onKeyDown={handleKeyDown}
              onDragOver={preventDefault}
              onDrop={preventDefault}
              placeholder={
                status === "idle"
                  ? "Message Claude..."
                  : status === "connecting"
                    ? "Connecting..."
                    : status === "disconnected"
                      ? "Disconnected"
                      : "Claude is working..."
              }
              disabled={status === "disconnected" || status === "connecting"}
              rows={1}
              className="flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-normal text-canvas-fg placeholder:text-canvas-muted/50 focus:outline-none disabled:opacity-50"
              style={{ fontSize: "16px" }}
            />
            {isActive ? (
              <button
                type="button"
                onClick={onStop}
                className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500 transition-all duration-200 hover:bg-red-600 active:scale-90"
                title="Stop generation"
              >
                <FiSquare size={12} className="text-white" fill="white" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-200 disabled:opacity-20"
                style={{
                  backgroundColor: canSend ? "var(--accent)" : "var(--canvas-muted)",
                  transform: canSend ? "scale(1)" : "scale(0.9)",
                }}
                title={hasPendingUpload ? "Waiting for uploads..." : "Send"}
              >
                <FiArrowUp size={16} className="text-white" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
      <MentionPopover
        ref={popoverRef}
        open={popoverOpen}
        dirPart={mention.dirPart}
        prefixPart={mention.prefixPart}
        hasSlash={mention.hasSlash}
        anchorRef={textareaRef}
        onAccept={handleAcceptMention}
        onClose={handleCloseMention}
      />
    </div>
  );
}
