"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/lib/use-is-mobile";
import { useMentions } from "@/lib/use-mentions";
import type { ClaudeStatus } from "@/lib/types";
import type { ContextUsage } from "@/lib/use-claude-chat";
import { preloadMarkdown } from "./message-bubble";
import { AttachmentRow } from "./chat-input/attachment-row";
import type { AttachmentPillData } from "./chat-input/attachment-pill";
import { MentionPopover, type MentionPopoverHandle } from "./chat-input/mention-popover";
import { ComposerToolbar } from "./composer/composer-toolbar";
import { ContextUsageBadge } from "./composer/context-usage-badge";
import type { ModeValue } from "./composer/composer-constants";

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

  /* ── Lifted from the old top Mode/Effort bar / HUD popup ────────── */
  permissionMode: string;
  setPermissionMode: (next: ModeValue) => void;
  effort: string | null;
  setEffort: (next: string | null) => void;
  model: string | null;
  setModel: (next: string | null) => void;
  contextUsage: ContextUsage | null;
}

/** Statuses where Claude is actively working and can be stopped. */
const ACTIVE_STATUSES = new Set<ClaudeStatus>([
  "thinking",
  "tool_running",
  "awaiting_permission",
  "awaiting_input",
]);

/** Auto-grow ceiling for the textarea, in pixels. */
const DEFAULT_COMPOSER_MAX_HEIGHT = 120;
const EXPANDED_COMPOSER_MAX_HEIGHT = 240;

export function ChatInput({
  status,
  onSend,
  onStop,
  initialText,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  onClearAttachments,
  permissionMode,
  setPermissionMode,
  effort,
  setEffort,
  model,
  setModel,
  contextUsage,
}: ChatInputProps) {
  const isMobile = useIsMobile();
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState<number | null>(null);
  // While recording, the wave pill takes the textarea's slot. We hide
  // (not unmount) the textarea so the user's draft + caret position
  // survive the round-trip.
  const [isRecording, setIsRecording] = useState(false);
  // Auto-grow ceiling for the textarea. Default 120px keeps the
  // composer compact for typed messages; when a voice transcript is
  // inserted we bump it to 240px so the user can read + edit longer
  // dictated text without scrolling. Reset on send.
  const [composerMaxHeight, setComposerMaxHeight] = useState(DEFAULT_COMPOSER_MAX_HEIGHT);
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
      el.style.height = `${Math.min(el.scrollHeight, composerMaxHeight)}px`;
      el.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSeq]);

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      // Snapshot the files into a real Array BEFORE resetting the input
      // value. `input.files` is a live FileList in some browsers and gets
      // cleared when we set `value = ""`, so iterating it afterwards
      // yields an empty list and no files get attached — which was the
      // symptom of uploads silently failing after picking from the dialog.
      const target = e.target;
      const files: File[] = target.files ? Array.from(target.files) : [];
      target.value = "";
      if (files.length === 0) return;
      await onAddFiles(files);
    },
    [onAddFiles],
  );

  // Append (not replace) transcribed voice text into the composer. Joins
  // with a single space when the textarea already has content so the user
  // can dictate in chunks. Bumps the auto-grow ceiling to 240px so longer
  // dictated text is readable without scrolling; reset on send.
  const handleTranscribed = useCallback((transcript: string) => {
    setText((prev) => (prev.trim().length > 0 ? `${prev.trimEnd()} ${transcript}` : transcript));
    setComposerMaxHeight(EXPANDED_COMPOSER_MAX_HEIGHT);
    queueMicrotask(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, EXPANDED_COMPOSER_MAX_HEIGHT)}px`;
      el.focus();
      const end = el.value.length;
      el.selectionStart = end;
      el.selectionEnd = end;
      setCaret(end);
    });
  }, []);

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
    setComposerMaxHeight(DEFAULT_COMPOSER_MAX_HEIGHT);
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
    el.style.height = `${Math.min(el.scrollHeight, composerMaxHeight)}px`;
  }, [composerMaxHeight]);

  // Native textarea cancels external file drops by default. preventDefault
  // on dragover + drop lets the outer dropzone handle it. We do NOT handle
  // the drop here — just stop the browser's default so the event bubbles
  // to the panel-level FileDropzone in ChatView.
  const preventDefault = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const voiceDisabled = status === "disconnected" || status === "connecting";

  return (
    // The OUTER wrapper has NO bottom padding — the pill itself extends
    // all the way to the screen bottom (iOS draws the home-indicator
    // gesture line over the pill's bottom edge; the pill is glass).
    // `<ContextUsageBadge />` lives INSIDE the pill, below the toolbar,
    // so the user gets it "below the input" while the pill stays
    // pinned to the very bottom of the screen. Safe-area-bottom is
    // applied on the inner content's `paddingBottom` so the badge
    // text clears the home-indicator zone.
    <div className="shrink-0 px-3 pt-2">
      <div className={`mx-auto ${hasContent ? "md:max-w-6xl" : "md:max-w-5xl"}`}>
        {/* Refined liquid-glass composer pill — single-recipe `.lg-bubble`
            (clean backdrop-blur + 1 px hairline + inset highlight + drop
            shadow). The text passing under it reads as cleanly frosted
            glass, the same shape as the floating top bubbles. */}
        <div
          className={`lg-bubble rounded-[24px] transition-transform duration-300 ease-out ${
            hasContent ? "-translate-y-1" : ""
          }`}
        >
          <div
            className="flex flex-col px-3 pt-2.5"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 10px)" }}
          >
            <AttachmentRow attachments={attachments} onRemove={onRemoveAttachment} />

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
              className={`w-full resize-none bg-transparent px-1 py-1 text-[15px] leading-normal text-canvas-fg placeholder:text-canvas-muted/50 focus:outline-none disabled:opacity-50 ${
                isRecording ? "hidden" : ""
              }`}
              style={{ fontSize: "16px" }}
            />

            <ComposerToolbar
              fileInputRef={fileInputRef}
              onFileInputChange={handleFileInput}
              permissionMode={permissionMode}
              setPermissionMode={setPermissionMode}
              model={model}
              setModel={setModel}
              effort={effort}
              setEffort={setEffort}
              contextUsage={contextUsage}
              voiceDisabled={voiceDisabled}
              onTranscribed={handleTranscribed}
              onRecordingChange={setIsRecording}
              isActive={isActive}
              canSend={canSend}
              hasPendingUpload={hasPendingUpload}
              onSend={handleSend}
              onStop={onStop}
              isMobile={isMobile}
            />

            {/* Context % indicator lives INSIDE the pill, below the
                toolbar. Keeps the user's "below the input" placement
                while letting the pill itself extend to the screen
                bottom — the previous outside-the-pill layout left
                visible canvas-bg space below the pill (badge offset
                + safe-area), which the user wanted gone. */}
            <ContextUsageBadge usage={contextUsage} />
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
