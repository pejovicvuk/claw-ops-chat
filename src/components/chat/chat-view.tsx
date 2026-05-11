"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiArrowDown,
  FiArrowLeft,
  FiShield,
  FiAlertTriangle,
  FiAlertOctagon,
} from "react-icons/fi";
import { useClaudeChat } from "@/lib/use-claude-chat";
import { formatStreamingHint } from "@/lib/format-streaming-hint";
import type { ChatMessage } from "@/lib/types";
import { useIsMobile } from "@/lib/use-is-mobile";
import { useVisualViewport } from "@/lib/use-visual-viewport";
import { useUrlState } from "@/lib/use-url-state";
import { useComposerAttachments } from "@/lib/use-composer-attachments";
import { fetchSessionMessages } from "@/lib/api";
import type { UploadEntry } from "@/lib/batch-upload";
import { HeaderIndicators } from "./header-indicators";
import { MessageBubble } from "./message-bubble";
import { MobileTopChrome } from "./mobile-top-chrome";
import { SessionCwdProvider } from "@/lib/session-cwd-context";
import { ChatFilesProvider } from "@/lib/chat-files-context";
import { ChatInput } from "./chat-input";
import { SetupGuard } from "./setup-guard";
import { EmptyState } from "./empty-state";
import { FileDropzone } from "./file-browser/file-dropzone";
import { PushReminderBanner } from "./push-reminder-banner";
import { MODE_LABELS, type ModeValue } from "./composer/composer-constants";

/** Playful gerunds used in place of plain "Thinking..." in the live
    activity indicator. One is picked at random each time Claude enters the
    thinking state, so successive turns surface different ones. */
const THINKING_VERBS: string[] = [
  "Coombobuling",
  "Discombobulating",
  "Bamboozling",
  "Flimflamming",
  "Jiggery-pokering",
  "Finagling",
  "Hoodwinking",
  "Noodling",
  "Kerfuffling",
  "Gallivanting",
  "Conjuring nonsense",
  "Unraveling codswallop",
  "Wrangling shenanigans",
  "Dabbling",
  "Befuddling",
  "Hornswoggling",
];

/**
 * Top-pinned banner that appears whenever the agent is awaiting any kind
 * of user response (permission, plan acceptance, or AskUserQuestion).
 *
 * Lives ABOVE the messages scroll container — never inside it — so it's
 * impossible to scroll past, content-visibility-skip, or overflow-clip.
 * Tapping the banner scrolls the latest pending inline card into view via
 * the `data-approval-id` attribute that PermissionRequestBlock /
 * PlanProposalBlock / AskQuestionBlock now expose.
 *
 * Identical on desktop and mobile. The previous floating pill only watched
 * permission_request and was nested inside the absolute-positioned scroll
 * container, which is what produced the "approval visible on phone but
 * not desktop" bug.
 */
function ApprovalBanner({
  messages,
  scrollRef,
}: {
  messages: ChatMessage[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const pending = messages.filter(
    (m) =>
      (m.type === "permission_request" && !m.permissionResolved) ||
      (m.type === "plan_proposal" && !m.planResolved) ||
      (m.type === "ask_question" && !m.askResolved),
  );
  if (pending.length === 0) return null;
  const latest = pending[pending.length - 1];
  const id = latest.permissionId ?? latest.planId ?? latest.askId ?? "";
  const label =
    latest.type === "permission_request"
      ? `Approval needed · ${latest.toolName ?? "Tool"}`
      : latest.type === "plan_proposal"
        ? "Plan ready for review"
        : "Claude is waiting for your input";
  return (
    <button
      type="button"
      onClick={() => {
        if (!id) return;
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-approval-id="${id}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }}
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center justify-center gap-1.5 border-b border-accent/40 bg-accent/10 px-3 py-2 text-[12px] font-semibold text-accent"
    >
      <FiShield size={12} />
      <span>
        {label}
        {pending.length > 1 ? ` · +${pending.length - 1} more` : ""} — tap to review
      </span>
    </button>
  );
}

interface ChatViewProps {
  sessionId: string;
  resumeSessionId?: string | null;
  onBack?: () => void;
  headerless?: boolean;
  onSessionCreated?: (claudeSessionId: string) => void;
  /** Mobile-only: invoked by the floating sessions glass bubble. */
  onOpenSessions?: () => void;
  /** Mobile-only: invoked by the floating files glass bubble. */
  onOpenFiles?: () => void;
  /** Mobile-only: invoked by the floating accent "+" new-chat bubble. */
  onNewChat?: () => void;
  /**
   * Initial working directory for a NEW chat (no resumeSessionId).
   * Used by the per-item canvas to scope a session to the item's
   * folder. Resumes still load `sessionCwd` from the persisted session
   * metadata.
   */
  defaultCwd?: string | null;
}

export function ChatView({
  sessionId,
  resumeSessionId,
  onBack,
  headerless,
  onSessionCreated,
  onOpenSessions,
  onOpenFiles,
  onNewChat,
  defaultCwd,
}: ChatViewProps) {
  const isMobile = useIsMobile();
  // `defaultCwd` seeds new chats with a scoped working directory (e.g.
  // an item's folder under ~/projects). Resumes overwrite this with the
  // persisted session metadata in the effect below.
  const [sessionCwd, setSessionCwd] = useState<string | null>(defaultCwd ?? null);
  const {
    messages,
    status,
    activeTool,
    claudeSessionId,
    sendMessage,
    stopGeneration,
    setupRequired,
    authRequired,
    clearAuthRequired,
    contextUsage,
    permissionMode,
    effort,
    model,
    respondPermission,
    respondQuestion,
    respondPlan,
    setPermissionMode,
    setEffort,
    setModel,
    reconnect,
    setInitialMessages,
    setInitialContextUsage,
  } = useClaudeChat(sessionId, sessionCwd);
  const notifiedSessionRef = useRef<string | null>(null);
  const { setParam } = useUrlState();
  const { viewportHeight } = useVisualViewport();

  // Attachments live here (not in ChatInput) so drops on the whole chat
  // pane feed the same list as the paperclip button.
  const composerAttachments = useComposerAttachments();
  const handlePanelDrop = useCallback(
    (entries: UploadEntry[]) => {
      // Flatten folders to a flat file list — the composer only shows a
      // flat attachment row; preserving folder structure isn't useful for
      // referencing (each file is independently `@-mentioned`).
      return composerAttachments.addFiles(entries.map((e) => e.file));
    },
    [composerAttachments],
  );

  // Auto-open the Claude Code sign-in panel on the rising edge of
  // `authRequired`. The server emits that event when Anthropic's API
  // returns 401 inside a turn — the user almost always wants to
  // re-auth right now, so pushing them straight to the right settings
  // page beats the old copy that told them to manually navigate to
  // "Settings → Terminal". The ref gates the effect to the transition
  // from null → non-null so re-renders during an active expired state
  // don't keep re-opening the panel.
  const prevAuthRequiredRef = useRef<boolean>(false);
  useEffect(() => {
    const isActive = !!authRequired;
    if (isActive && !prevAuthRequiredRef.current) {
      setParam("settings", "connections/claude");
    }
    prevAuthRequiredRef.current = isActive;
  }, [authRequired, setParam]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  // Mirrors `userScrolledUpRef` as React state so the glass
  // scroll-to-bottom button can subscribe to it. Both update together
  // in handleScroll. The ref stays for non-render logic that doesn't
  // need to trigger re-renders (e.g. the auto-scroll suppression).
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  // Unread arrival counter — kept around so the auto-scroll bookkeeping
  // below has the right "did anything actually arrive?" signal even
  // though the visible button no longer shows the count. Coarse-grained:
  // bumps only on `messages.length` increments, so streaming text into
  // an existing assistant bubble doesn't tick wildly.
  const [unreadCount, setUnreadCount] = useState(0);
  const prevMessagesLengthRef = useRef(0);
  // Stagger first-load history messages only; new streaming messages animate
  // without delay. Set captured once when loadingHistory flips false.
  const historyIdsRef = useRef<string[]>([]);
  const capturedHistoryRef = useRef(false);
  const [loadingHistory, setLoadingHistory] = useState(!!resumeSessionId);
  // Pre-fills the composer from empty-state suggestion chips. The seq
  // version bumps on every click so ChatInput's effect re-runs even when
  // the user clicks the same chip twice.
  const [draft, setDraft] = useState<{ text: string; seq: number }>({ text: "", seq: 0 });
  const handleSuggestionClick = useCallback((text: string) => {
    setDraft((prev) => ({ text, seq: prev.seq + 1 }));
  }, []);
  // Funny "thinking" verb — rerolled each time status enters `thinking`
  // from another state so every turn shows a fresh gerund. Lazy init picks
  // the first one at mount so there's no blank flash on the very first turn.
  const [thinkingVerb, setThinkingVerb] = useState<string>(
    () => THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)],
  );
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (status === "thinking" && prevStatusRef.current !== "thinking") {
      setThinkingVerb(THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)]);
    }
    prevStatusRef.current = status;
  }, [status]);
  // Turn-elapsed tracking for the hover tooltip on the live activity
  // indicator. We snapshot the wall clock when status enters
  // thinking/tool_running from idle, and clear it when status returns to
  // idle. The status oscillates between thinking ↔ tool_running within a
  // single turn (Claude → tool → Claude → tool → …), so we deliberately
  // do NOT reset the timer on those intermediate transitions — the user
  // wants total time for "this turn", not the latest leg.
  const [turnStartedAtMs, setTurnStartedAtMs] = useState<number | null>(null);
  useEffect(() => {
    const isActive = status === "thinking" || status === "tool_running";
    if (isActive && turnStartedAtMs === null) {
      setTurnStartedAtMs(Date.now());
    } else if (!isActive && turnStartedAtMs !== null) {
      setTurnStartedAtMs(null);
    }
  }, [status, turnStartedAtMs]);
  // 1Hz tick while a turn is active so the elapsed string ticks up live
  // when the user hovers the indicator. Runs only when needed — no
  // background timer when Claude is idle.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (turnStartedAtMs === null) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [turnStartedAtMs]);
  const [infoMessages, setInfoMessages] = useState<
    Array<{ id: string; content: string; timestamp: number }>
  >([]);
  const bridgeSyncedRef = useRef(false);

  /**
   * Wraps the SDK setter so any mode change — whether triggered by the
   * composer's mode picker or by the Shift+Tab keyboard cycler — also
   * surfaces a small info-message pill in the message stream so the
   * user notices the switch even when their eyes are on the messages.
   */
  const handleModeChange = useCallback(
    (next: ModeValue) => {
      if (next !== permissionMode) {
        const label = MODE_LABELS[next] ?? next;
        setInfoMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            content: `Switched to ${label} mode`,
            timestamp: Date.now(),
          },
        ]);
      }
      setPermissionMode(next);
    },
    [permissionMode, setPermissionMode],
  );

  // Indicator-popup state and outside-click dismissal moved into
  // <HeaderIndicators />. ChatView no longer owns it.

  /* Notify parent when SDK creates a new session (so page can update selected session) */
  useEffect(() => {
    // Only fire when the SDK assigns an id that differs from the URL's
    // sessionId — i.e. a fresh chat just got promoted from its
    // client-generated UUID to the SDK's real one. For chats the user
    // is *resuming* (sessionId already === claudeSessionId), this would
    // otherwise re-fire on every switch because my reset effect nulls
    // claudeSessionId on session change and the next session_init then
    // looks "new" relative to notifiedSessionRef. The parent's
    // handleSessionCreated calls invalidateSessions + loadSessions,
    // which flips the sidebar's loading state and was the visible flash
    // in the conversation list.
    if (
      claudeSessionId &&
      claudeSessionId !== sessionId &&
      claudeSessionId !== notifiedSessionRef.current
    ) {
      notifiedSessionRef.current = claudeSessionId;
      onSessionCreated?.(claudeSessionId);
    }
  }, [claudeSessionId, sessionId, onSessionCreated]);

  // On the first `idle` after reconnect, push our remembered per-session
  // mode to the server so a container restart doesn't land the session in
  // "default" when the toolbar still shows Plan or Auto.
  useEffect(() => {
    if (status === "idle" && !bridgeSyncedRef.current) {
      bridgeSyncedRef.current = true;
      if (permissionMode !== "default") {
        setPermissionMode(permissionMode);
      }
    }
  }, [status, permissionMode, setPermissionMode]);

  // Keyboard parity with the Claude Code CLI: Shift+Tab cycles modes,
  // Esc interrupts while Claude is working. Ignored while a text input
  // / textarea is focused so message composition isn't disrupted.
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      // Shift+Tab → cycle default → plan → acceptEdits → auto → default
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        const order = ["default", "plan", "acceptEdits", "auto"] as const;
        const idx = order.indexOf(permissionMode as (typeof order)[number]);
        const next = order[(idx + 1) % order.length] ?? "default";
        handleModeChange(next);
        return;
      }

      // Esc → stop Claude mid-turn
      if (e.key === "Escape" && (status === "thinking" || status === "tool_running")) {
        e.preventDefault();
        stopGeneration();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [permissionMode, handleModeChange, status, stopGeneration]);

  useEffect(() => {
    // Switching to "+ New chat" — no history to load, just clear out any
    // messages left over from the previous chat. Without this clear, when
    // ChatView is no longer keyed on sessionId (it used to remount on
    // every switch), the previous chat's messages would leak into the
    // empty new-chat view.
    if (!resumeSessionId) {
      setInitialMessages([]);
      setInitialContextUsage(null);
      setSessionCwd(null);
      setLoadingHistory(false);
      capturedHistoryRef.current = false;
      historyIdsRef.current = [];
      return;
    }
    // Switching to an existing chat — show the loading skeleton WHILE
    // keeping the old chat's messages on screen until the new ones land.
    // setInitialMessages is called in the .then() below, atomically
    // replacing the array so the user perceives a clean cross-fade
    // instead of a flash to blank.
    let cancelled = false;
    setLoadingHistory(true);
    capturedHistoryRef.current = false;
    fetchSessionMessages(resumeSessionId)
      .then((data) => {
        if (!cancelled) {
          setInitialMessages(data.messages);
          setInitialContextUsage(data.contextUsage);
          setSessionCwd(data.sessionCwd);
          setLoadingHistory(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        // 404 — the SDK hasn't written a JSONL for this id yet. Could
        // happen if the user lands on a session right after sending its
        // very first message, before Claude has produced any output.
        // Falling through to an empty list gives the empty-state UI.
        setInitialMessages([]);
        setInitialContextUsage(null);
        setSessionCwd(null);
        setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resumeSessionId, setInitialMessages, setInitialContextUsage]);

  // Force-scroll the latest pending approval into view exactly once per
  // approval id — even if the user has manually scrolled up, an arriving
  // permission / plan / ask prompt MUST be unmissable. Tracked by id so
  // we don't fight the user's subsequent scrolling on unrelated re-
  // renders. Falls through to the unread-count + stick-to-bottom logic
  // when nothing is pending.
  const lastScrolledApprovalIdRef = useRef<string | null>(null);
  useEffect(() => {
    let latestPending: string | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.type === "permission_request" && !m.permissionResolved) {
        latestPending = m.permissionId ?? null;
        break;
      }
      if (m.type === "plan_proposal" && !m.planResolved) {
        latestPending = m.planId ?? null;
        break;
      }
      if (m.type === "ask_question" && !m.askResolved) {
        latestPending = m.askId ?? null;
        break;
      }
    }
    if (latestPending && latestPending !== lastScrolledApprovalIdRef.current) {
      lastScrolledApprovalIdRef.current = latestPending;
      // requestAnimationFrame: when this effect fires from a
      // pending_approvals snapshot the inline card was just appended to
      // `messages` and hasn't been laid out yet — scrolling on the same
      // tick targets stale geometry. One frame is enough.
      requestAnimationFrame(() => {
        const el = scrollRef.current?.querySelector<HTMLElement>(
          `[data-approval-id="${latestPending}"]`,
        );
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        else bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      });
      // We just scrolled the user to the bottom of the conversation; clear
      // the unread pill so it doesn't linger over the approval card. Keep
      // prevMessagesLengthRef in sync so the next non-approval render
      // doesn't double-count messages added in this batch.
      setUnreadCount(0);
      prevMessagesLengthRef.current = messages.length;
      return;
    }

    const prev = prevMessagesLengthRef.current;
    const curr = messages.length;
    prevMessagesLengthRef.current = curr;
    // Clamped at 0 to ignore wholesale message-array replacements (e.g.
    // session switch into a shorter chat) — those wipe userScrolledUpRef
    // separately and shouldn't show as "negative new messages."
    const delta = Math.max(0, curr - prev);

    if (userScrolledUpRef.current) {
      // User is reading scrollback — surface the pill instead of yanking.
      // infoMessages aren't part of `messages`, so triggering Shift+Tab
      // while scrolled up doesn't bump the count.
      if (delta > 0) setUnreadCount((c) => c + delta);
      return;
    }
    // At bottom — keep the existing smooth follow-along behavior.
    setUnreadCount(0);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, infoMessages]);

  // On chat switch, snap-jump to the bottom of the new chat once history
  // finishes loading. Two reasons this needs its own effect rather than
  // leaning on the message-change scroll above:
  //   1. `userScrolledUpRef` is preserved across sessions — if the user
  //      had scrolled up in the previous chat, the message-change effect
  //      would silently skip the auto-scroll on the new one. We wipe the
  //      lock here on every sessionId change.
  //   2. Smooth-scrolling across a wholesale message replacement looks
  //      janky; an instant `behavior: "auto"` jump fits the cross-fade
  //      transition that `setInitialMessages` produces. The rAF defers
  //      the call until the freshly-loaded messages have committed to
  //      the DOM so `scrollHeight` reflects them.
  useEffect(() => {
    userScrolledUpRef.current = false;
    // Drop any unread count carried over from the previous chat — the
    // new chat is about to be snap-jumped to bottom, so a stale "N new
    // messages" pill from another session would be misleading.
    setUnreadCount(0);
    if (loadingHistory) return;
    const id = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    });
    return () => cancelAnimationFrame(id);
  }, [sessionId, loadingHistory]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    userScrolledUpRef.current = !atBottom;
    setIsScrolledUp(!atBottom);
    // Auto-dismiss the unread bookkeeping once the user manually scrolls
    // back into the at-bottom band — they've caught up.
    if (atBottom) setUnreadCount(0);
  };

  /** Memoized sorted merge of chat messages and info messages. */
  const sortedMessages = useMemo(() => {
    const infoAsMsgs = infoMessages.map((m) => ({
      ...m,
      role: "system" as const,
      type: "text" as const,
      _isInfo: true,
    }));
    return [...messages.map((m) => ({ ...m, _isInfo: false })), ...infoAsMsgs].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  }, [messages, infoMessages]);

  /** Find the ID of the latest tool_use message (for live activity indicator). */
  const latestToolUseId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === "tool_use") return messages[i].id;
    }
    return null;
  }, [messages]);

  /**
   * Map toolCallId → matching tool_use message so ToolResultBlock can
   * render per-tool previews (e.g. inline image for Read, unfurl card
   * for WebFetch) without re-scanning the message list.
   */
  const toolUseByCallId = useMemo(() => {
    const map = new Map<string, (typeof messages)[number]>();
    for (const m of messages) {
      if (m.type === "tool_use" && m.toolCallId) map.set(m.toolCallId, m);
    }
    return map;
  }, [messages]);

  // Capture the first-load snapshot once — these IDs get staggered animation
  // delays on mount. Post-capture arrivals (streaming) animate without delay.
  useEffect(() => {
    if (!loadingHistory && !capturedHistoryRef.current && sortedMessages.length) {
      historyIdsRef.current = sortedMessages.map((m) => m.id);
      capturedHistoryRef.current = true;
    }
  }, [loadingHistory, sortedMessages]);

  return (
    <FileDropzone onUpload={handlePanelDrop} size="panel" className="relative flex flex-1 flex-col">
      <div
        className="relative flex flex-1 flex-col"
        style={{ height: headerless ? "100%" : viewportHeight, overflow: "hidden" }}
      >
        {!headerless && (
          // The mobile branch in <ChatLayout /> already reserves the
          // safe-area-top for the notch on its outer wrapper, and the
          // desktop branch has no safe area to worry about — so this
          // toolbar's padding is purely visual breathing room. Adding
          // env(safe-area-inset-top) here on top of the wrapper's own
          // env() doubled the notch reservation on iOS PWAs (47 + 47 =
          // 94 px of dead space) — that's the "too fixed / pushed-down"
          // look the layout had before.
          <div className="flex shrink-0 items-center gap-2 border-b border-canvas-border px-3 py-2.5">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover"
              >
                <FiArrowLeft size={18} />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-canvas-fg">Claude</p>
            </div>
            <HeaderIndicators status={status} activeTool={activeTool} reconnect={reconnect} />
          </div>
        )}

        {/* Headerless mode renders different chrome per viewport:
         *
         *  - Mobile  → no in-flow toolbar at all. Floating
         *    `<MobileTopChrome />` glass bubbles + a `.scroll-fade-top`
         *    blur scrim sit on top of the chat. Messages scroll
         *    edge-to-edge under both, and the white iOS status-bar
         *    icons stay legible against the frosted band.
         *  - Desktop → keep the slim utility bar; it just hosts the
         *    HeaderIndicators cluster aligned right (no sessions /
         *    files icons on desktop, those live in the grid sidebars).
         */}
        {headerless && isMobile && (onOpenSessions || onOpenFiles || onNewChat) && (
          <>
            <div className="scroll-fade-top" aria-hidden="true" />
            <MobileTopChrome
              onOpenSessions={onOpenSessions ?? (() => {})}
              onOpenFiles={onOpenFiles ?? (() => {})}
              onNewChat={onNewChat ?? (() => {})}
              status={status}
              activeTool={activeTool}
              reconnect={reconnect}
            />
          </>
        )}
        {headerless && !isMobile && (
          <div className="flex shrink-0 items-center gap-2 px-3 py-1.5">
            <div className="ml-auto">
              <HeaderIndicators status={status} activeTool={activeTool} reconnect={reconnect} />
            </div>
          </div>
        )}

        {authRequired && (
          <div
            className={`shrink-0 border-b px-4 py-2.5 ${
              authRequired.reason === "subscription_expired"
                ? "border-red-500/30 bg-red-500/10"
                : "border-amber-500/30 bg-amber-500/10"
            }`}
          >
            <div className="flex items-start gap-2.5">
              {authRequired.reason === "subscription_expired" ? (
                <FiAlertOctagon size={14} className="mt-0.5 shrink-0 text-red-400" />
              ) : (
                <FiAlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
              )}
              <div className="min-w-0 flex-1 text-[12px] leading-relaxed">
                <p
                  className={`font-medium ${
                    authRequired.reason === "subscription_expired"
                      ? "text-red-300"
                      : "text-amber-300"
                  }`}
                >
                  {authRequired.reason === "subscription_expired"
                    ? "Claude subscription inactive"
                    : "Claude sign-in expired"}
                </p>
                <p className="mt-0.5 text-canvas-muted">{authRequired.message}</p>
                {authRequired.reason !== "subscription_expired" && (
                  <p className="mt-1 text-canvas-muted">
                    The sign-in panel has opened — finish the flow there, then retry the message.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-1.5">
                {authRequired.reason === "subscription_expired" ? (
                  <a
                    href="https://claude.ai/settings/billing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md bg-red-500 px-2 py-1 text-[11px] font-medium text-white hover:opacity-90"
                  >
                    View billing
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => setParam("settings", "connections/claude")}
                    className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white hover:opacity-90"
                  >
                    Go to sign-in
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearAuthRequired}
                  aria-label="Dismiss"
                  className="rounded-md bg-canvas-bg px-2 py-1 text-[11px] font-medium text-canvas-fg hover:bg-canvas-surface-hover"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <PushReminderBanner />
        <ApprovalBanner messages={messages} scrollRef={scrollRef} />
        <div className="relative flex-1">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="absolute inset-0 overflow-y-auto overflow-x-hidden"
          >
            {loadingHistory && messages.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-canvas-border border-t-canvas-muted" />
                <span className="ml-2 text-[12px] text-canvas-muted">Loading conversation...</span>
              </div>
            )}
            {!loadingHistory && messages.length === 0 && status === "idle" ? (
              <EmptyState onSuggestionClick={handleSuggestionClick} />
            ) : (
              <SessionCwdProvider value={sessionCwd}>
                <ChatFilesProvider sessionId={sessionId}>
                  <div className={isMobile ? "pt-3 pb-2" : "mx-auto w-full max-w-6xl py-3 pb-32"}>
                    {/* eslint-disable-next-line react-hooks/refs -- historyIdsRef is captured once via effect then stable; safe to read during render for first-load stagger delays */}
                    {sortedMessages.map((msg, idx) => {
                      // Staggered enter animation for first-load history only —
                      // streaming messages (idx not in historyIdsRef) animate
                      // instantly. Capped at 12 * 25ms so a huge backlog doesn't
                      // visibly cascade for half a second.
                      const histIdx = historyIdsRef.current.indexOf(msg.id);
                      // History messages (loaded from JSONL on session switch
                      // or initial mount) appear instantly — re-running the
                      // fade-in for every message on every chat switch was
                      // the visible "disappear and reappear" flash. Only
                      // genuinely-new streaming messages animate in.
                      const isHistory = histIdx >= 0;
                      const enterAnim = isHistory ? "" : "animate-msg-in";
                      const staggerStyle: React.CSSProperties | undefined = undefined;

                      if (msg._isInfo) {
                        return (
                          <div
                            key={msg.id}
                            className={`${enterAnim} flex justify-center px-4 py-1.5`}
                            style={staggerStyle}
                          >
                            <span className="rounded-full bg-canvas-surface-hover px-3 py-1 text-[11px] text-canvas-muted">
                              {msg.content}
                            </span>
                          </div>
                        );
                      }
                      // Timeline nodes (thinking / tool_use / tool_result) are the
                      // ambient "Claude is working" stream. Wrap each one in a
                      // container that paints a subtle left rail so contiguous nodes
                      // read as a single vertical timeline. User bubbles, assistant
                      // replies, and interactive cards break the rail cleanly.
                      const isTimelineNode =
                        msg.type === "thinking" ||
                        msg.type === "tool_use" ||
                        msg.type === "tool_result";
                      const prev = idx > 0 ? sortedMessages[idx - 1] : null;
                      const next = idx < sortedMessages.length - 1 ? sortedMessages[idx + 1] : null;
                      const prevIsTimeline =
                        !!prev &&
                        !prev._isInfo &&
                        (prev.type === "thinking" ||
                          prev.type === "tool_use" ||
                          prev.type === "tool_result");
                      const nextIsTimeline =
                        !!next &&
                        !next._isInfo &&
                        (next.type === "thinking" ||
                          next.type === "tool_use" ||
                          next.type === "tool_result");
                      return (
                        <div
                          key={msg.id}
                          className={`${enterAnim} ${
                            isTimelineNode ? "ml-4 border-l border-accent/15 pl-1" : ""
                          } ${isTimelineNode && !prevIsTimeline ? "mt-2 pt-1" : ""} ${
                            isTimelineNode && !nextIsTimeline ? "mb-2 pb-1" : ""
                          }`}
                          style={staggerStyle}
                        >
                          <MessageBubble
                            message={msg}
                            isLatestToolUse={msg.type === "tool_use" && msg.id === latestToolUseId}
                            siblingToolUse={
                              msg.type === "tool_result" && msg.toolCallId
                                ? toolUseByCallId.get(msg.toolCallId)
                                : undefined
                            }
                            onPermissionRespond={respondPermission}
                            onQuestionRespond={respondQuestion}
                            onPlanRespond={respondPlan}
                          />
                        </div>
                      );
                    })}
                    {(status === "thinking" || status === "tool_running") && (
                      <div className="animate-msg-in group relative flex w-fit items-center gap-2.5 px-5 py-2">
                        <svg viewBox="0 0 240 200" className="thinking-loader" aria-hidden="true">
                          <g filter="url(#thinking-goo)">
                            <circle className="blob blob-a" cx="120" cy="100" r="36" />
                            <circle className="blob blob-b" cx="120" cy="100" r="28" />
                            <circle className="blob blob-c" cx="120" cy="100" r="24" />
                            <circle className="core" cx="120" cy="100" r="14" />
                          </g>
                        </svg>
                        <span className="text-accent text-[14px] font-medium">
                          {status === "tool_running" && activeTool
                            ? `Running ${activeTool.name}...`
                            : `${thinkingVerb}...`}
                        </span>
                        {/*
                         * Hover tooltip — terminal-style live counter.
                         * Hidden by default, fades in on group-hover so it
                         * never competes visually with the indicator
                         * itself. `pointer-events-none` so it can't
                         * accidentally swallow clicks on whatever's
                         * underneath. Lives ABOVE the indicator
                         * (`bottom-full`) so the cursor isn't blocked by
                         * the tooltip while hovering the row.
                         */}
                        <span
                          role="tooltip"
                          aria-hidden="true"
                          className="pointer-events-none absolute bottom-full left-5 z-10 mb-1 whitespace-nowrap rounded-md border border-canvas-border bg-canvas-surface px-2 py-1 font-mono text-[10px] text-canvas-fg opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
                        >
                          {formatStreamingHint({
                            elapsedMs: turnStartedAtMs === null ? 0 : nowMs - turnStartedAtMs,
                            outputTokens: contextUsage?.outputTokens,
                            inputTokens: contextUsage?.inputTokens,
                          })}
                        </span>
                      </div>
                    )}
                    <div ref={bottomRef} />
                  </div>
                </ChatFilesProvider>
              </SessionCwdProvider>
            )}
          </div>

          {/* Bottom blur scrim — mirrors `.scroll-fade-top`. Chat text
              scrolling DOWN past the floating composer gets gradually
              frosted and fades out near the screen bottom, exactly the
              way the top edge fades under the iOS status bar. Only on
              mobile + headerless (the floating-composer surface);
              desktop keeps its existing layout where the composer
              already overlays a `pb-32` chat scroll area. */}
          {isMobile && headerless && <div className="scroll-fade-bottom" aria-hidden="true" />}

          {/* Awaiting-input awareness lives in <ApprovalBanner /> above
              the scroll container — it covers permission, plan, AND ask,
              and can't be content-visibility-skipped or overflow-clipped
              the way the old in-scroller floating pill could. */}

          {/* Scroll-to-bottom button moved out of the messages area —
              see the composer wrapper below. */}
        </div>

        <SetupGuard forceShow={setupRequired}>
          {/* Composer floats over the chat on EVERY viewport now: the
              outer wrapper is `pointer-events: none` so taps fall through
              to the messages behind it, and only the actual ChatInput
              chrome captures input via the `[&_*]:pointer-events-auto`
              child selector. With this in place, chat content scrolls
              underneath the composer pill and the `.scroll-fade-bottom`
              scrim frosts the band where text passes under it — same
              shape Anthropic's iOS app uses. The previous `relative`
              treatment on mobile pinned the composer in flex flow, so
              messages physically couldn't scroll behind it. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 [&_*]:pointer-events-auto">
            <ChatInput
              status={status}
              onSend={sendMessage}
              onStop={stopGeneration}
              initialText={draft}
              attachments={composerAttachments.attachments}
              onAddFiles={composerAttachments.addFiles}
              onRemoveAttachment={composerAttachments.remove}
              onClearAttachments={composerAttachments.clear}
              permissionMode={permissionMode}
              setPermissionMode={handleModeChange}
              effort={effort}
              setEffort={setEffort}
              model={model}
              setModel={setModel}
              contextUsage={contextUsage}
            />

            {/* Liquid-glass scroll-to-bottom button. Lives INSIDE the
                composer wrapper so its position automatically follows
                the composer's height: the wrapper anchors to bottom: 0
                and grows upward as ChatInput's natural height changes
                (textarea auto-grow, attachments, context badge), and
                `-top-14` keeps the button a fixed gap above the
                wrapper's top edge — i.e. above the pill — regardless of
                state. Mobile renders the same way (right-aligned), since
                the mobile wrapper is now `relative`.
                The badge sits in an outer wrapper as a sibling of the
                button so its negative `-right-1 -top-1` offsets can
                poke past the button's bounds. */}
            {isScrolledUp && (
              <div className="animate-msg-in pointer-events-auto absolute -top-14 right-4 z-20 h-9 w-9 md:left-1/2 md:right-auto md:-translate-x-1/2">
                <button
                  type="button"
                  onClick={() => {
                    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
                    setUnreadCount(0);
                  }}
                  aria-label={
                    unreadCount > 0
                      ? `Scroll to bottom — ${unreadCount} new ${unreadCount === 1 ? "message" : "messages"}`
                      : "Scroll to bottom"
                  }
                  title="Scroll to bottom"
                  className="lg-bubble flex h-full w-full items-center justify-center rounded-full text-canvas-fg transition-transform duration-150 hover:scale-105 active:scale-95"
                >
                  <FiArrowDown size={16} />
                </button>
                {unreadCount > 0 && (
                  <span
                    className="pointer-events-none absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-none text-white"
                    style={{ backgroundColor: "var(--accent)" }}
                    aria-hidden="true"
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </div>
            )}
          </div>
        </SetupGuard>
      </div>
    </FileDropzone>
  );
}
