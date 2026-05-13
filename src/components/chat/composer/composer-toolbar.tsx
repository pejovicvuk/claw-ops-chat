"use client";

import type { RefObject, ChangeEvent, ReactNode } from "react";
import { FiArrowUp, FiMic, FiPlus, FiSquare } from "react-icons/fi";
import type { ContextUsage } from "@/lib/use-claude-chat";
import type { DictationState } from "@/lib/use-dictation";
import type { ModeValue } from "./composer-constants";
import { ModePicker } from "./mode-picker";
import { ModelThinkingPicker } from "./model-thinking-picker";

interface ComposerToolbarProps {
  /** File input ref + handler — ownership stays in ChatInput so the same
   *  hidden `<input>` can be triggered from the empty composer's
   *  click-anywhere flow if we ever add it. */
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileInputChange: (e: ChangeEvent<HTMLInputElement>) => void;

  // Permission mode
  permissionMode: string;
  setPermissionMode: (v: ModeValue) => void;

  // Model + thinking
  model: string | null;
  setModel: (v: string | null) => void;
  effort: string | null;
  setEffort: (v: string | null) => void;
  contextUsage: ContextUsage | null;

  // Send / stop
  isActive: boolean;
  canSend: boolean;
  hasPendingUpload: boolean;
  onSend: () => void;
  onStop: () => void;

  // Dictation — when the composer is empty and the browser supports
  // Web Speech, the right-most slot morphs from send → mic.
  dictationSupported: boolean;
  dictationState: DictationState;
  dictationError: string | null;
  composerEmpty: boolean;
  onStartDictation: () => void;
  onStopDictation: () => void;

  /** Narrow viewport — collapses pickers to icon-only labels. */
  isMobile?: boolean;
}

/**
 * The bottom row of the composer pill. Lays out, left to right:
 *
 *   + attach    Mode    [flex spacer]    Model · Thinking    🎤/⬆
 *
 * The attach `<label>`-wraps the hidden `<input type="file">` so the
 * native picker opens on a real user gesture without needing JS — same
 * cross-browser fix the old inline button used (chat-input.tsx pre-
 * refactor). Keeping the ref + change handler in the parent avoids a
 * second source of truth for the file input.
 *
 * The send/stop button keeps the exact visual contract from before the
 * toolbar refactor: red square while a turn is in flight, accent
 * up-arrow otherwise. Only the location moved.
 */
export function ComposerToolbar({
  fileInputRef,
  onFileInputChange,
  permissionMode,
  setPermissionMode,
  model,
  setModel,
  effort,
  setEffort,
  contextUsage,
  isActive,
  canSend,
  hasPendingUpload,
  onSend,
  onStop,
  dictationSupported,
  dictationState,
  dictationError,
  composerEmpty,
  onStartDictation,
  onStopDictation,
  isMobile,
}: ComposerToolbarProps): ReactNode {
  const isDictating = dictationState !== "idle";
  const showMic = !isActive && !canSend && composerEmpty && dictationSupported && !isDictating;
  return (
    <div className="flex items-center gap-1.5">
      <label
        aria-label="Attach files"
        title="Attach files"
        className="btn-press flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-canvas-muted transition-colors duration-150 hover:bg-canvas-surface-hover hover:text-canvas-fg"
      >
        <FiPlus size={16} />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onFileInputChange}
        />
      </label>

      <ModePicker value={permissionMode} onChange={setPermissionMode} compact={isMobile} />

      <div className="flex-1" />

      <ModelThinkingPicker
        model={model}
        setModel={setModel}
        effort={effort}
        setEffort={setEffort}
        contextUsage={contextUsage}
        compact={isMobile}
      />

      {isActive ? (
        <button
          type="button"
          onClick={onStop}
          className="btn-press flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500 transition-all duration-200 hover:bg-red-600"
          title="Stop generation"
        >
          <FiSquare size={12} className="text-white" fill="white" />
        </button>
      ) : isDictating ? (
        <div className="relative flex shrink-0 items-center">
          <button
            type="button"
            onClick={onStopDictation}
            className="btn-press flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500 transition-all duration-200 hover:bg-red-600"
            title="Stop dictation"
            aria-label="Stop dictation"
          >
            <FiSquare size={12} className="text-white" fill="white" />
          </button>
          {dictationError && (
            <span
              role="alert"
              className="pointer-events-none absolute -top-7 right-0 max-w-[220px] truncate rounded-md bg-red-500/10 px-2 py-1 text-[10px] text-red-500"
            >
              {dictationError}
            </span>
          )}
        </div>
      ) : showMic ? (
        <div className="relative flex shrink-0 items-center">
          <button
            type="button"
            onClick={onStartDictation}
            className="btn-press flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-200"
            style={{ backgroundColor: "var(--accent)" }}
            title="Dictate in Serbian"
            aria-label="Start dictation"
          >
            <FiMic size={15} className="text-white" />
          </button>
          {dictationError && (
            <span
              role="alert"
              className="pointer-events-none absolute -top-7 right-0 max-w-[220px] truncate rounded-md bg-red-500/10 px-2 py-1 text-[10px] text-red-500"
            >
              {dictationError}
            </span>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          className="btn-press flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-200 disabled:opacity-20"
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
  );
}
