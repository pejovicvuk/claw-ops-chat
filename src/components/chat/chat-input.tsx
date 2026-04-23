"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FiArrowUp, FiPaperclip, FiSquare } from "react-icons/fi";
import { createFolder, deleteFile, uploadFile, FileApiError } from "@/lib/api";
import { useToast } from "@/lib/use-toast";
import { useMentions } from "@/lib/use-mentions";
import type { ClaudeStatus } from "@/lib/types";
import { preloadMarkdown } from "./message-bubble";
import { AttachmentRow } from "./chat-input/attachment-row";
import type { AttachmentPillData } from "./chat-input/attachment-pill";
import { isImageName } from "./chat-input/attachment-pill";
import { MentionPopover, type MentionPopoverHandle } from "./chat-input/mention-popover";
import { FileDropzone } from "./file-browser/file-dropzone";

interface ChatInputProps {
  status: ClaudeStatus;
  onSend: (text: string) => void;
  onStop: () => void;
  /** External pre-fill (e.g. from empty-state suggestion chips). The
      effect re-runs on every `seq` bump so clicking the same suggestion
      twice still fills the composer; empty-string values are ignored so
      we don't wipe the user's in-progress draft. */
  initialText?: { text: string; seq: number };
}

/** Statuses where Claude is actively working and can be stopped. */
const ACTIVE_STATUSES = new Set<ClaudeStatus>([
  "thinking",
  "tool_running",
  "awaiting_permission",
  "awaiting_input",
]);

// Where attachments go on disk. Lives directly under CLAUDE_CWD so Claude
// always has it in its working directory.
const UPLOADS_DIR = "~/uploads";

/** Runtime-local attachment — mirrors `AttachmentPillData` but tracked with the upload controller. */
interface Attachment extends AttachmentPillData {
  controller: AbortController;
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Sanitize a filename for server-side relativePath use. Keep dots and
 * alphanumerics; replace everything else with `-`. Mirrors (loosely) the
 * `safeFilename` logic on the server but here it's purely for display-nice
 * uploaded paths. The server still re-sanitizes.
 */
function safeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function makeUploadName(file: File): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${ts}-${safeName(file.name) || "file"}`;
}

function errMsg(err: unknown): string {
  if (err instanceof FileApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Upload failed";
}

export function ChatInput({ status, onSend, onStop, initialText }: ChatInputProps) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [caret, setCaret] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<MentionPopoverHandle>(null);
  /** Ensure we only try to mkdir once per session. */
  const uploadsDirReady = useRef(false);

  // @-mention state derived from the textarea value + caret position. The
  // popover subscribes to `dirPart` via `useFileListings` so the first
  // render reads from localStorage cache — no network flash when the file
  // browser has been open recently.
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

  // Sync external pre-fills (suggestion chips) into the composer. Depend
  // on the seq so identical text bumped by a second click still triggers
  // a fill. Empty text is ignored so we don't wipe in-progress drafts.
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
    // initialText is captured via the seq read above; effect intentionally
    // keyed to seq so only explicit bumps re-fire the fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSeq]);

  // Revoke any outstanding blob URLs on unmount so images don't leak.
  useEffect(() => {
    return () => {
      for (const a of attachments) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
    };
    // Intentionally empty deps — we only want the cleanup on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadOne = useCallback(async (file: File, existingId?: string): Promise<void> => {
    // Ensure `~/uploads` exists (recursive + idempotent). Only try once.
    if (!uploadsDirReady.current) {
      try {
        await createFolder("~", { name: "uploads", recursive: true });
      } catch {
        /* Directory may already exist or be writable — let the upload
             itself surface real errors. */
      }
      uploadsDirReady.current = true;
    }

    const id = existingId ?? genId();
    const uploadName = makeUploadName(file);
    const previewUrl = isImageName(file.name) ? URL.createObjectURL(file) : undefined;
    const controller = new AbortController();

    const draft: Attachment = {
      id,
      name: file.name,
      size: file.size,
      previewUrl,
      progress: 0,
      controller,
    };

    setAttachments((prev) => {
      if (existingId && prev.some((a) => a.id === existingId)) {
        return prev.map((a) =>
          a.id === existingId
            ? { ...draft, previewUrl: a.previewUrl ?? previewUrl, error: undefined }
            : a,
        );
      }
      return [...prev, draft];
    });

    try {
      await uploadFile(UPLOADS_DIR, file, {
        relativePath: uploadName,
        signal: controller.signal,
        onProgress: (frac) => {
          setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, progress: frac } : a)));
        },
      });
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, progress: 1, uploadedPath: `${UPLOADS_DIR}/${uploadName}` } : a,
        ),
      );
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        // Aborted during upload — the ×-click handler already removed the
        // pill from state, nothing to update here.
        return;
      }
      setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, error: errMsg(err) } : a)));
    }
  }, []);

  /** Shared entry-point for both drag-drop and the file-picker button. */
  const handleAttach = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      await Promise.all(files.map((f) => uploadOne(f)));
    },
    [uploadOne],
  );

  /** FileDropzone emits `UploadEntry[]`; drop the relativePath, we only want flat files. */
  const handleDropzoneUpload = useCallback(
    async (entries: { file: File; relativePath: string }[]) => {
      await handleAttach(entries.map((e) => e.file));
    },
    [handleAttach],
  );

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      e.target.value = "";
      if (!list || list.length === 0) return;
      const files: File[] = [];
      for (let i = 0; i < list.length; i++) files.push(list[i]);
      await handleAttach(files);
    },
    [handleAttach],
  );

  const handleRemove = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) {
        // Kill any in-flight upload.
        if (!target.uploadedPath && !target.error) {
          try {
            target.controller.abort();
          } catch {
            /* noop */
          }
        }
        // Revoke blob URL.
        if (target.previewUrl) URL.revokeObjectURL(target.previewUrl);
        // Best-effort server-side cleanup for already-uploaded files.
        if (target.uploadedPath) {
          deleteFile(target.uploadedPath).catch(() => {
            /* non-fatal — user can clean up in the files panel */
          });
        }
      }
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const handleRetry = useCallback(
    (id: string) => {
      setAttachments((prev) => {
        const target = prev.find((a) => a.id === id);
        if (!target) return prev;
        // We don't keep the raw File around — the user has to re-pick. Surface
        // a hint; a future pass can stash the File on the Attachment.
        toast.info("Retrying failed uploads isn't wired yet — remove and re-add the file.");
        return prev;
      });
    },
    [toast],
  );

  const handleSend = useCallback(() => {
    if (!canSend) return;
    preloadMarkdown();
    const refs = attachments.filter((a) => a.uploadedPath).map((a) => `@${a.uploadedPath}`);
    const trimmed = text.trim();
    const final =
      refs.length > 0 ? (trimmed ? `${trimmed}\n\n${refs.join("\n")}` : refs.join("\n")) : text;
    onSend(final);

    // Clear composer state. Revoke blob URLs; leave uploaded files on disk.
    for (const a of attachments) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    setAttachments([]);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [canSend, text, attachments, onSend]);

  /** Replace the active `@…` range with a completed token. */
  const handleAcceptMention = useCallback(
    (token: string, isDirectory: boolean) => {
      if (!mention.open) return;
      const before = text.slice(0, mention.rangeStart);
      const after = text.slice(mention.rangeEnd);
      const next = `${before}${token}${after}`;
      setText(next);
      // After accept, place caret right after the inserted token. For
      // directories we keep the popover live on the trailing `/` — the
      // user types more to drill deeper.
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
      // Popover keys (arrow / enter / tab / escape) — it returns true when
      // it consumed the event, in which case we preventDefault so the
      // textarea doesn't also react (e.g. Enter inserting a newline).
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
    fileInputRef.current?.click();
  }, []);

  return (
    <div
      className="shrink-0 px-3 py-2"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 8px)" }}
    >
      <FileDropzone
        onUpload={handleDropzoneUpload}
        className="mx-auto md:max-w-3xl md:focus-within:max-w-4xl"
      >
        <div className="glass-input flex flex-col rounded-2xl px-2.5 py-1.5 transition-all duration-300 ease-out focus-within:-translate-y-1 focus-within:px-3 focus-within:py-2 focus-within:shadow-[0_12px_40px_rgba(0,0,0,0.14)]">
          <AttachmentRow attachments={attachments} onRemove={handleRemove} onRetry={handleRetry} />

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
      </FileDropzone>
      <MentionPopover
        ref={popoverRef}
        open={popoverOpen}
        dirPart={mention.dirPart}
        prefixPart={mention.prefixPart}
        anchorRef={textareaRef}
        onAccept={handleAcceptMention}
        onClose={handleCloseMention}
      />
    </div>
  );
}
