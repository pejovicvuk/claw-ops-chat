import "dotenv/config";
import { createServer, IncomingMessage } from "http";
import { parse } from "url";
import { readFileSync } from "fs";
import { access, rm, stat } from "fs/promises";
import { spawn, type ChildProcess } from "child_process";
import { dirname, join, sep } from "path";
import { homedir } from "os";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
/* SDK loaded via sdk-loader.js (plain CJS) to prevent tsx/esbuild from
   transforming the require and breaking the SDK's import.meta.url resolution. */
import sdk from "./sdk-loader.js";
const { query } = sdk as typeof import("@anthropic-ai/claude-agent-sdk");
import { extractSessionFromCookieHeader } from "./src/lib/auth-server";
import { consumeWsTicket } from "./src/lib/ws-ticket-store";
import { execGit, GitExecError } from "./src/lib/git/exec";
import { detectClaude } from "./src/lib/claude-status";
import { resolveShell } from "./src/lib/terminal-shell";
import {
  loadCredentialsSync as loadAtlassianCredentials,
  migrateLegacyCredentials as migrateAtlassianLegacy,
} from "./src/lib/atlassian-custom-config";
import { loadCredentialsSync as loadTrelloCredentials } from "./src/lib/trello-custom-config";
import { augmentPathWithLocalBin } from "./src/lib/platform-detect";
import { existsSync, readdirSync, statSync } from "fs";
import {
  setSessionStatus,
  clearSessionStatus,
  type SessionStatus,
} from "./src/lib/session-status-store";
import { setRuntimeAuthFailed } from "./src/lib/claude-auth-runtime-state";
import {
  loadAllSessions,
  persistSession,
  type PersistedSession,
} from "./src/lib/session-persistence";
import { getCustomAppendForSdk } from "./src/lib/agent-config";
import { getDisallowedHostedGoogleMcpTools } from "./src/lib/hosted-mcp-blocklist";
import {
  snapshotFromAssistantUsage,
  extractContextWindow,
  DEFAULT_CONTEXT_WINDOW,
} from "./src/lib/context-usage";
import { applyRateLimitEvent as applyAccountRateLimitEvent } from "./src/lib/account-rate-limits";
import { startRateLimitProbe } from "./src/lib/rate-limit-probe";
import { safePath, SafePathError } from "./src/lib/safe-path";
import { decideCronTool, type ToolPolicy } from "./src/lib/reports/tool-policy";
import type { CronRunOutcome } from "./src/lib/reports/runner";
import { ReportScheduler } from "./src/lib/reports/scheduler";
import { setScheduler } from "./src/lib/reports/scheduler-singleton";
import { ensureProjectsTree } from "./src/lib/projects/paths";
import {
  consolidatorClaudeProjectsDir,
  ensureMemoryTree,
  sanitizeCwdForClaude,
} from "./src/lib/memory/paths";
import { getGlobalMemoryAppend } from "./src/lib/memory/global-injector";
import { ensureSdkAutoMemoryEnabled } from "./src/lib/memory/sdk-settings";
import { migrateAgentConfigToMemory } from "./src/lib/memory/migrate-from-agent-config";
import { ConsolidationScheduler } from "./src/lib/memory/consolidator";
import { loadAutoMemoryConfig } from "./src/lib/memory/auto-config";
import { setSessionManager } from "./src/lib/reports/session-manager-singleton";
import { setChatSendHandle } from "./src/lib/chat-send-singleton";
import { getAuditWriter } from "./src/lib/audit/writer";
import { navUrls } from "./src/lib/nav-urls";
import { onNotificationDispatched, sendToUser } from "./src/lib/push/send";
import { ensureAuditTree } from "./src/lib/audit/paths";
import { purgeOldAuditFiles } from "./src/lib/audit/retention";
import { purgeOldUnfurls } from "./src/lib/proxy/unfurl-cache";
import { purgeOldImages } from "./src/lib/proxy/image-cache";
import { maybeRunScheduledPrune } from "./src/lib/monitoring/docker-prune";
import { sweepStaleDrops } from "./src/lib/preview-stream/file-drop";
import { sweepStaleDownloads } from "./src/lib/preview-stream/download-relay";
import { migrateGoogleMcpTier } from "./src/lib/google-custom-config";
import { logWsUpgrade } from "./src/lib/audit/api-wrap";
import {
  forwardHttp,
  matchPreviewPath,
  PREVIEW_PREFIX,
} from "./src/lib/preview-proxy/http-forward";
import { forwardWs } from "./src/lib/preview-proxy/ws-forward";
import { handlePreviewStream } from "./src/lib/preview-stream/handler";
import { handlePreviewRtc } from "./src/lib/preview-stream/webrtc-handler";
import { close as closeChromiumPool } from "./src/lib/preview-stream/chromium-pool";
import { killAll as killAllDevServers } from "./src/lib/dev-server/manager";
import { bootstrapMonitoring } from "./src/lib/monitoring/bootstrap";
import { getMonitoringBroadcaster } from "./src/lib/monitoring/ws-broadcast";
import {
  wsRecordIncoming,
  wsRecordOutgoing,
  wsRegisterSession,
  wsRemoveSession,
  wsUpdateSession,
} from "./src/lib/monitoring/ws-session-store";
import type { MonFrame } from "./src/lib/monitoring/types";
import cron from "node-cron";

// node-pty has a native binding — require it lazily so the server can still
// start if the binding is missing, and only blow up when the terminal is used.
type NodePty = typeof import("node-pty");
let ptyModule: NodePty | null = null;
let ptyLoadError: Error | null = null;
function loadPty(): NodePty {
  if (ptyModule) return ptyModule;
  if (ptyLoadError) throw ptyLoadError;
  try {
    ptyModule = require("node-pty") as NodePty;
    return ptyModule;
  } catch (err) {
    ptyLoadError = err instanceof Error ? err : new Error("Failed to load node-pty");
    throw ptyLoadError;
  }
}

// Custom spawn that normalizes paths (fixes Windows backslash ENOENT).
// We do NOT set pathToClaudeCodeExecutable on the SDK options — the SDK
// resolves its own bundled entry (sdk.mjs) via package exports. The old
// hardcoded '…/claude-agent-sdk/cli.js' worked on legacy v1.x SDK but the
// v0.2.x Agent SDK collapsed cli.js into sdk.mjs, so the old path ENOENT'd
// on every query and surfaced as "Claude Code process exited with code 1".
function spawnClaude(opts: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
}): ChildProcess {
  const cmd = opts.command.split(sep).join("/");
  const args = opts.args.map((a) => a.split(sep).join("/"));
  return spawn(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["pipe", "pipe", "pipe"],
    signal: opts.signal,
    windowsHide: true,
  });
}

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3100", 10);
const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL || "";
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:8080").replace(
  /\/+$/,
  "",
);

/** Allowed origins for WebSocket connections. Auto-populated from ALLOWED_ORIGINS env or defaults. */
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

/**
 * Permission / question / plan response timeout in ms.
 * Default bumped from 5 minutes → 24 hours so users who step away from
 * the tab don't come back to silently auto-denied approvals (which
 * previously manifested as "Claude stops for no reason" — it received
 * a "Response timed out" denial and then hallucinated a workaround).
 * Set to 0 (or any non-positive value) to disable the timeout entirely.
 */
const RESPONSE_TIMEOUT_MS = parseInt(process.env.RESPONSE_TIMEOUT_MS || "86400000", 10);

/**
 * Re-read MCP servers from ~/.claude.json fresh on every turn. The file is
 * mutated at runtime by the settings flows (Google, Bitbucket, Notion,
 * Trello, etc. all call registerMcpServer / unregisterMcpServer), and if
 * we cached the list at process startup any MCP registered after boot —
 * the common case for a user wiring up their first Google connection —
 * would stay invisible until the container restarted.
 *
 * Read is synchronous for simplicity; the file is tiny and lives on the
 * container's local disk. handleUserMessage is already a long-running async
 * function, one extra sync readFileSync per turn is noise.
 */
function loadMcpServers(): Record<string, unknown> | undefined {
  try {
    const claudeJson = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf-8"));
    if (claudeJson.mcpServers && Object.keys(claudeJson.mcpServers).length > 0) {
      return claudeJson.mcpServers;
    }
  } catch {
    /* No ~/.claude.json or invalid — return undefined, SDK runs without MCP. */
  }
  return undefined;
}

/* One-shot log of whatever was registered when the server booted — purely
   for operator visibility; the actual value used per-turn is re-read below. */
try {
  const initial = loadMcpServers();
  if (initial) {
    console.log(`> Loaded MCP servers: ${Object.keys(initial).join(", ")}`);
  }
} catch {
  /* ignore */
}

/** Heartbeat interval in ms (default: 30 seconds). */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Maximum WebSocket messages per second per session (default: 20). */
const WS_RATE_LIMIT = parseInt(process.env.WS_RATE_LIMIT || "20", 10);

const claudeInfo = detectClaude();
if (claudeInfo.available) {
  console.log(`> Claude Code: ${claudeInfo.version} at ${claudeInfo.path}`);
} else {
  console.warn(`> Claude Code: not available — ${claudeInfo.error}`);
}

if (!ALLOWED_EMAIL) {
  console.error("FATAL: ALLOWED_EMAIL environment variable is required");
  process.exit(1);
}

if (!dev && ALLOWED_ORIGINS.size === 0) {
  console.warn(
    "!! ALLOWED_ORIGINS is not set. In production all cross-origin WebSocket " +
      "connections will be rejected. Set ALLOWED_ORIGINS=https://your-domain.com in the .env file.",
  );
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChatSession {
  id: string;
  clients: Set<WebSocket>;
  claudeSessionId: string | null;
  isProcessing: boolean;
  messageQueue: Array<{ text: string }>;
  pendingRequests: Map<string, (response: Record<string, unknown>) => void>;
  sessionAllowedTools: Set<string>;
  permissionMode: string;
  effort: string | null;
  /**
   * Per-session model override. `null` means "Auto" — let the SDK pick
   * its default for the user's subscription. Otherwise one of the SDK's
   * model aliases (`opus` / `sonnet` / `haiku`) which the SDK resolves
   * to the latest concrete version on each turn — durable across
   * Anthropic version bumps without server code changes.
   */
  model: string | null;
  requestCounter: number;
  accumulatedText: string;
  /** Rate limiting: message timestamps in the current sliding window. */
  messageTimestamps: number[];
  /** Event history for reconnecting clients. */
  eventHistory: Record<string, unknown>[];
  /** Last activity timestamp (for idle cleanup). */
  lastActivity: number;
  /** Abort controller for the current query — allows stopping mid-stream. */
  abortController: AbortController | null;
  /**
   * Active SDK Query handle for the current turn. Held here so the `stop`
   * client message can call `.interrupt()` for a graceful SDK-level stop
   * (emits a proper `result` with interrupt subtype) before falling back
   * to AbortController. Null when no turn is in flight.
   */
  currentQuery: {
    interrupt?: () => Promise<void>;
    setPermissionMode?: (mode: string) => Promise<void>;
    setModel?: (model?: string) => Promise<void>;
  } | null;
  /**
   * Set to true when the `stop` client message aborts the current turn.
   * The for-await loop's catch block checks this flag and skips the
   * usual "error" broadcast — the user explicitly asked us to stop, so
   * surfacing the resulting AbortError as a failure would be noise on
   * top of the clean "Stopped by user" result we already sent.
   */
  userAborted: boolean;
  /** Original cwd for resume (the cwd where this session was first created). */
  sessionCwd: string | null;
  /**
   * Current git branch of `sessionCwd`. Refreshed on connect and at each
   * turn_complete. Null when the cwd isn't a git repo or HEAD is detached.
   * Surfaced to the UI so the branch list can mark which branches have
   * active chats.
   */
  branchName: string | null;
  /**
   * Current high-level status of this session. Mirrored into the shared
   * session-status-store so the REST /api/sessions/status endpoint can
   * surface it to the sidebar without going through a WebSocket.
   */
  status: SessionStatus;
  /**
   * Last user message sent into this session. Persisted to disk so a
   * post-restart client can show "Resume last: <msg>" when the prior
   * turn was killed mid-stream.
   */
  lastUserMessage: string;
  /**
   * True when this session was rehydrated from disk and was in an
   * active state (thinking/tool_running/awaiting_*) when the server
   * died. The reconnect handler broadcasts an `interrupted` event once
   * so the first client to reconnect sees a banner.
   */
  wasInterrupted: boolean;
  /**
   * When set, this session is an autonomous cron run and every tool
   * decision routes through decideCronTool — the interactive permission
   * prompts are bypassed entirely. Null for regular chat sessions.
   */
  cronPolicy: Extract<ToolPolicy, { kind: "cron" }> | null;
  /**
   * Callback fired exactly once when a cron run terminates (success,
   * error, or abort). Cleared immediately after invocation.
   */
  cronOnComplete: ((outcome: CronRunOutcome) => void) | null;
  /**
   * Fan-out hook for cron runs so the runner can tee SDK events into a
   * .log.jsonl without taking a dependency on the WebSocket pipeline.
   */
  cronOnEvent: ((event: Record<string, unknown>) => void) | null;
  /** Wall-clock abort timer for the current cron run (if any). */
  cronAbortTimer: NodeJS.Timeout | null;
  /** Accumulates token usage across assistant messages for cron runs. */
  cronTokenUsage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreate: number;
  };
  /**
   * Authoritative context-window cap for this session, learned from
   * `result.modelUsage[modelId].contextWindow` after the first turn
   * completes. Until then the broadcaster falls back to
   * DEFAULT_CONTEXT_WINDOW (1M). Never read tokens *out* of
   * result.modelUsage — those fields are cumulative across the turn.
   */
  lastContextWindow?: number;
  /** Model id paired with `lastContextWindow`. */
  lastModelId?: string;
  /**
   * Number of consecutive "No conversation found" retries for the current
   * user message. Prevents infinite recursion when Claude's resume is
   * broken. Reset to 0 on every successful result; capped at 2.
   */
  retryCount: number;
  /** Authenticated email of the client that established this session, for audit. */
  actorEmail: string;
  /**
   * Short preview (first ~80 chars of the first user message) used as
   * the chat's display name in notification titles. Set lazily on the
   * first user message; never overwritten so refresh-resume keeps the
   * stable label. Falls back to "Chat" when empty.
   */
  displayPreview: string;
  /**
   * Idempotency cache of clientMessageIds seen recently. Both the
   * /api/chat/send HTTP path and the legacy WebSocket "message" path
   * check this before queuing/processing so a fetch retry (e.g. browser
   * replaying after a flaky network) never delivers the same message
   * twice. Capped at 50 entries — FIFO eviction in enqueueUserMessage.
   */
  recentClientMessageIds: Set<string>;
  /**
   * Map<tool_use_id, { name, input }> populated when a tool call's input
   * finishes streaming and consumed when its tool_result arrives. Lets
   * the tool_result handler look up the (file_path) input for Write /
   * Edit / MultiEdit so it can stat the post-write file and fire a
   * `file_changed` event for the editor to live-reload.
   */
  pendingToolInputs: Map<string, { name: string; input: Record<string, unknown> }>;
}

/**
 * Check whether Claude Code has a persisted JSONL file for the given
 * session id. The SDK writes conversation history to
 * ~/.claude/projects/<project-hash>/<session-id>.jsonl once a session
 * has produced at least one assistant turn. Used to decide whether a
 * UUID-shaped sessionId coming in over the WebSocket represents a real
 * resumable conversation or a brand-new chat the client just invented.
 */
/**
 * Short, notification-friendly label for a chat session. Falls back to
 * a generic "Chat" when the session has not yet processed a user
 * message (the displayPreview fills in lazily — see handleUserMessage).
 */
function chatLabelFor(session: ChatSession): string {
  const preview = session.displayPreview?.trim();
  if (preview) {
    return preview.length > 60 ? `${preview.slice(0, 57)}…` : preview;
  }
  return "Chat";
}

function claudeSessionFileExists(sessionId: string): boolean {
  const projectsDir = join(homedir(), ".claude", "projects");
  if (!existsSync(projectsDir)) return false;
  const target = `${sessionId}.jsonl`;
  try {
    for (const proj of readdirSync(projectsDir)) {
      const projPath = join(projectsDir, proj);
      const s = statSync(projPath, { throwIfNoEntry: false });
      if (!s || !s.isDirectory()) continue;
      if (existsSync(join(projPath, target))) return true;
    }
  } catch {
    /* ignore read errors */
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Session Manager                                                    */
/* ------------------------------------------------------------------ */

/**
 * Short, per-process random hex injected into every pending-request ID so
 * IDs never collide across server restarts. The client persists the set of
 * already-answered request IDs to sessionStorage (so a reload doesn't
 * re-prompt the user). Without a boot prefix, after a container restart
 * the server's `requestCounter` resets to 0 and regenerates ids like
 * `req-1`, `req-2`, ... — which the client's dedup cache has already
 * marked "resolved". That caused the observed "agent is waiting for
 * approval but no modal appears" bug: the new permission_request events
 * were silently dropped as stale.
 */
const SERVER_BOOT_ID = Math.random().toString(36).slice(2, 10);

class SessionManager {
  private sessions = new Map<string, ChatSession>();

  // Global credential-failure gate. When ANY session hits a Claude 401 /
  // subscription error, all subsequent turns across ALL sessions are blocked
  // and immediately receive an auth_required event so the user knows to
  // re-authenticate before creating new chats or retrying. Cleared on the
  // first successful SDK result after credentials are restored.
  private claudeAuthFailed = false;
  private claudeAuthFailedReason: "token_expired" | "subscription_expired" = "token_expired";
  private claudeAuthFailedHint =
    "Run `claude auth login` in the settings terminal, or click below.";
  // Maximum ms of silence from the SDK before the turn is force-aborted.
  // Reset on every SDK event so long tool executions aren't cut off while
  // actively streaming. 0 disables the timeout entirely.
  // Override via CLAUDE_TURN_TIMEOUT_MS env variable.
  private readonly turnInactivityMs = parseInt(process.env.CLAUDE_TURN_TIMEOUT_MS ?? "1800000", 10);

  getOrCreateSession(sessionId: string): ChatSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        clients: new Set(),
        claudeSessionId: null,
        isProcessing: false,
        messageQueue: [],
        pendingRequests: new Map(),
        sessionAllowedTools: new Set(),
        permissionMode: "default",
        effort: null,
        model: null,
        requestCounter: 0,
        accumulatedText: "",
        messageTimestamps: [],
        eventHistory: [],
        lastActivity: Date.now(),
        abortController: null,
        currentQuery: null,
        userAborted: false,
        sessionCwd: null,
        branchName: null,
        status: "idle",
        lastUserMessage: "",
        wasInterrupted: false,
        cronPolicy: null,
        cronOnComplete: null,
        cronOnEvent: null,
        cronAbortTimer: null,
        cronTokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
        retryCount: 0,
        actorEmail: "anonymous",
        displayPreview: "",
        recentClientMessageIds: new Set(),
        pendingToolInputs: new Map(),
      };
      this.sessions.set(sessionId, session);
      setSessionStatus(sessionId, "idle");
    }
    return session;
  }

  /**
   * Register an alias so a WebSocket that reconnects under
   * claudeSessionId lands on the SAME ChatSession object. Without this,
   * the client's "once the first reply arrives, URL → SDK session_id"
   * flow reconnects onto a brand-new empty session, the in-flight
   * query keeps streaming into the old (now client-less) one, and the
   * user sees the turn mysteriously hang. Safe to call repeatedly;
   * only writes if the target id isn't already mapped to this session.
   */
  aliasClaudeSessionId(session: ChatSession): void {
    const sid = session.claudeSessionId;
    if (!sid || sid === session.id) return;
    const existing = this.sessions.get(sid);
    if (existing === session) return;
    if (existing && existing !== session) {
      // Shouldn't happen in practice (server just created X in the SDK
      // and it's unique per turn) — but if it does, prefer the new
      // session and clean up the orphan so its clients reconnect onto
      // the canonical one.
      for (const client of existing.clients) {
        session.clients.add(client);
      }
    }
    this.sessions.set(sid, session);
    setSessionStatus(sid, session.status);
  }

  /**
   * Reconstruct a session from disk. Called once at boot for every
   * persisted session file. Runtime-only fields (clients, pending
   * requests, rate-limit timestamps, abort controller, message queue)
   * reset to empty; replayable state (eventHistory, claudeSessionId,
   * permissionMode, allowed-tools set) survives.
   */
  restoreFromDisk(persisted: PersistedSession): void {
    const midTurnStatus: SessionStatus[] = [
      "thinking",
      "tool_running",
      "awaiting_permission",
      "awaiting_input",
    ];
    const wasMidTurn = midTurnStatus.includes(persisted.status as SessionStatus);
    const session: ChatSession = {
      id: persisted.id,
      clients: new Set(),
      claudeSessionId: persisted.claudeSessionId ?? null,
      isProcessing: false,
      messageQueue: [],
      pendingRequests: new Map(),
      sessionAllowedTools: new Set(persisted.sessionAllowedTools ?? []),
      permissionMode: persisted.permissionMode || "default",
      effort: persisted.effort ?? null,
      model: persisted.model ?? null,
      requestCounter: 0,
      accumulatedText: persisted.accumulatedText ?? "",
      messageTimestamps: [],
      eventHistory: Array.isArray(persisted.eventHistory) ? persisted.eventHistory : [],
      lastActivity: persisted.lastActivity || Date.now(),
      abortController: null,
      currentQuery: null,
      userAborted: false,
      sessionCwd: persisted.sessionCwd ?? null,
      branchName: persisted.branchName ?? null,
      // Status is always reset to "idle" on boot — whatever was in
      // flight is gone. The wasInterrupted flag is what tells the
      // client something was cut short.
      status: "idle",
      lastUserMessage: persisted.lastUserMessage ?? "",
      wasInterrupted: wasMidTurn,
      cronPolicy: null,
      cronOnComplete: null,
      cronOnEvent: null,
      cronAbortTimer: null,
      cronTokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
      retryCount: 0,
      actorEmail: "anonymous",
      displayPreview: persisted.lastUserMessage ? persisted.lastUserMessage.slice(0, 80) : "",
      recentClientMessageIds: new Set(),
      pendingToolInputs: new Map(),
    };
    this.sessions.set(session.id, session);
    setSessionStatus(session.id, "idle");
    // Rehydrated session carries a claudeSessionId from disk — alias
    // it immediately so a reconnect under that id finds this session.
    this.aliasClaudeSessionId(session);
  }

  /**
   * Update session.status, mirror into the shared status store (for the
   * REST sidebar endpoint), and broadcast to any connected clients.
   * All other `broadcast({ type: "status", ... })` call sites are now
   * replaced with this helper so the two sources of truth can't drift.
   *
   * We deliberately write the store under BOTH the WebSocket session id
   * AND the SDK's claudeSessionId once it's known. `/api/sessions` keys
   * by the SDK session_id (JSONL filename), while our session map is
   * keyed by whatever the client passed in `?session=…`. For a new chat
   * those two ids are different — the sidebar was looking up status
   * under the wrong key and always seeing nothing, so users reported
   * "I don't see any indicators".
   */
  private setStatus(session: ChatSession, status: SessionStatus) {
    session.status = status;
    setSessionStatus(session.id, status);
    if (session.claudeSessionId && session.claudeSessionId !== session.id) {
      setSessionStatus(session.claudeSessionId, status);
    }
    this.broadcast(session, { type: "status", status });
    // Fire-and-forget disk persist so a crash between now and the next
    // setStatus call doesn't forget this transition. Errors are logged
    // but never thrown — persistence is belt-and-suspenders, not a
    // correctness primitive.
    this.queuePersist(session);
  }

  /**
   * Coalesced disk persist — each call schedules a write on a microtask
   * so a flurry of broadcasts (e.g. streaming text tokens) produces one
   * file write instead of hundreds. Safe to fire on every event.
   */
  private pendingPersists = new Set<string>();
  private queuePersist(session: ChatSession) {
    if (this.pendingPersists.has(session.id)) return;
    this.pendingPersists.add(session.id);
    queueMicrotask(() => {
      this.pendingPersists.delete(session.id);
      this.persistNow(session).catch((err) => {
        console.warn(`[session=${session.id}] persist failed:`, (err as Error).message);
      });
    });
  }

  private async persistNow(session: ChatSession): Promise<void> {
    await persistSession({
      id: session.id,
      status: session.status,
      permissionMode: session.permissionMode,
      effort: session.effort,
      model: session.model,
      claudeSessionId: session.claudeSessionId,
      sessionCwd: session.sessionCwd,
      branchName: session.branchName,
      eventHistory: session.eventHistory,
      sessionAllowedTools: Array.from(session.sessionAllowedTools),
      accumulatedText: session.accumulatedText,
      lastActivity: session.lastActivity,
      lastUserMessage: session.lastUserMessage,
      wasInterrupted: session.wasInterrupted,
    });
  }

  /**
   * Probe the git branch of the session's cwd. Empty stdout means
   * detached HEAD or non-repo — both stored as null. GitExecError is
   * swallowed to keep the existing branchName value (e.g. transient
   * filesystem hiccups shouldn't blank the chip).
   */
  private async refreshBranchName(session: ChatSession): Promise<void> {
    if (!session.sessionCwd) return;
    try {
      const result = await execGit(["branch", "--show-current"], {
        cwd: session.sessionCwd,
        timeoutMs: 2000,
      });
      if (result.code !== 0) return;
      const next = result.stdout.toString("utf-8").trim() || null;
      if (next !== session.branchName) {
        session.branchName = next;
        this.queuePersist(session);
      }
    } catch (err) {
      if (err instanceof GitExecError) return;
      // Anything else: log but don't surface — branch detection is
      // advisory, not load-bearing.
      console.warn(`[session=${session.id}] refreshBranchName failed:`, (err as Error).message);
    }
  }

  /**
   * Slim per-session view used by the /api/sessions/branches route to
   * mark active chats in the branch list. Mirrors the shape returned by
   * the disk-fallback walk in that route so the client only needs one
   * type.
   */
  listBranchSnapshots(): Array<{
    sessionId: string;
    claudeSessionId: string | null;
    branchName: string | null;
    sessionCwd: string | null;
    status: SessionStatus;
    display: string;
  }> {
    const out: Array<{
      sessionId: string;
      claudeSessionId: string | null;
      branchName: string | null;
      sessionCwd: string | null;
      status: SessionStatus;
      display: string;
    }> = [];
    const seen = new Set<ChatSession>();
    for (const session of this.sessions.values()) {
      if (seen.has(session)) continue;
      seen.add(session);
      out.push({
        sessionId: session.id,
        claudeSessionId: session.claudeSessionId,
        branchName: session.branchName,
        sessionCwd: session.sessionCwd,
        status: session.status,
        display: session.displayPreview || session.lastUserMessage.slice(0, 80) || "Chat",
      });
    }
    return out;
  }

  connect(
    ws: WebSocket,
    sessionId: string,
    sessionCwd?: string,
    actorEmail?: string,
    clientMeta?: { client?: string; ip?: string },
  ) {
    const session = this.getOrCreateSession(sessionId);
    session.clients.add(ws);
    if (actorEmail) session.actorEmail = actorEmail;
    wsRegisterSession({
      id: sessionId,
      client: clientMeta?.client,
      ip: clientMeta?.ip,
      clientCount: session.clients.size,
    });
    getAuditWriter()
      .session({
        type: "connected",
        severity: "info",
        actor: session.actorEmail,
        subject: `Chat WS connected ${sessionId}`,
        durationMs: null,
        sessionId,
        claudeSessionId: session.claudeSessionId,
        details: { clientCount: session.clients.size, cwd: sessionCwd ?? null },
      })
      .catch(() => {});

    // Only treat a UUID-shaped sessionId as a resumable SDK session when
    // Claude Code has actually written a JSONL file for it. Previously
    // ANY UUID got auto-bound as claudeSessionId, so a fresh chat
    // (handleNewChat generates a client-side UUID) would be passed into
    // query({ resume: <fake-uuid> }) → SDK throws "No conversation found
    // with session ID…" and the first message silently fails.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!session.claudeSessionId && UUID_RE.test(sessionId)) {
      try {
        if (claudeSessionFileExists(sessionId)) {
          session.claudeSessionId = sessionId;
        }
      } catch {
        /* best-effort — no resume if we can't verify */
      }
    }

    // Store the original cwd so SDK resume can find the session file.
    if (sessionCwd && !session.sessionCwd) {
      session.sessionCwd = sessionCwd;
    }

    // Detect the current git branch in the background — informs the
    // branch-list UI which chats are on which branch.
    void this.refreshBranchName(session);

    // Send current state to the new client
    this.send(ws, { type: "ready" });
    if (session.claudeSessionId) {
      this.send(ws, { type: "session_init", sessionId: session.claudeSessionId });
    }

    // Replay event history for reconnecting clients
    if (session.eventHistory.length > 0) {
      for (const event of session.eventHistory) {
        this.send(ws, event);
      }
    }

    // If credentials are known-broken, tell the new client immediately so it
    // shows the auth banner regardless of which session it connected to or
    // whether the user has navigated to a fresh chat since the failure.
    if (this.claudeAuthFailed) {
      this.send(ws, {
        type: "auth_required",
        provider: "claude",
        reason: this.claudeAuthFailedReason,
        message:
          this.claudeAuthFailedReason === "subscription_expired"
            ? "Your Claude subscription is inactive or has reached its usage limit."
            : "Claude rejected the stored credentials. Your OAuth token has probably expired.",
        hint: this.claudeAuthFailedHint,
      });
    }

    // Always send the current status snapshot on reconnect. Without this,
    // a browser that reconnected after a status change (e.g. after a
    // tool finished running) would sit on whatever state it had before
    // the disconnect — often showing "thinking…" forever, or worse,
    // silently missing the fact that a permission prompt is pending.
    // When auth is known-broken, always report idle so the client's stop
    // button can't get stuck in "thinking" due to a stale session.status.
    this.send(ws, { type: "status", status: this.claudeAuthFailed ? "idle" : session.status });

    // If the server was restarted while this session was mid-turn,
    // surface a one-shot "interrupted" event so the UI can render a
    // banner + Resume action. Fires only for the first client on the
    // first reconnect — after that we clear the flag and persist.
    if (session.wasInterrupted) {
      this.send(ws, {
        type: "interrupted",
        lastUserMessage: session.lastUserMessage || "",
      });
      session.wasInterrupted = false;
      this.queuePersist(session);
    }

    // Heartbeat: detect dead connections
    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, HEARTBEAT_INTERVAL_MS);

    ws.on("pong", () => {
      alive = true;
    });

    ws.on("message", (data) => {
      try {
        // Rate limiting
        if (!this.checkRateLimit(session)) {
          this.send(ws, { type: "error", message: "Rate limit exceeded. Slow down." });
          return;
        }

        const raw = data.toString();
        wsRecordIncoming(sessionId, Buffer.byteLength(raw, "utf-8"));
        const msg = JSON.parse(raw);
        this.handleMessage(session, ws, msg);
      } catch {
        console.warn(`[session=${sessionId}] Malformed WebSocket message`);
      }
    });

    ws.on("close", () => {
      clearInterval(heartbeat);
      session.clients.delete(ws);
      wsUpdateSession(sessionId, {
        clientCount: session.clients.size,
        queueDepth: session.messageQueue.length,
        pendingRequests: session.pendingRequests.size,
        lastActivityAt: Date.now(),
      });
      if (session.clients.size === 0) {
        wsRemoveSession(sessionId);
      }
      getAuditWriter()
        .session({
          type: "disconnected",
          severity: "info",
          actor: session.actorEmail,
          subject: `Chat WS disconnected ${sessionId}`,
          durationMs: null,
          sessionId,
          claudeSessionId: session.claudeSessionId,
          details: { clientCount: session.clients.size },
        })
        .catch(() => {});
      // Sessions stay alive even with 0 clients — work continues in background.
      // Only cleanup idle sessions (not processing, no clients) after 30 minutes.
      if (session.clients.size === 0 && !session.isProcessing) {
        setTimeout(
          () => {
            if (session.clients.size === 0 && !session.isProcessing) {
              // Check if truly idle for a while
              if (Date.now() - session.lastActivity > 30 * 60 * 1000) {
                this.sessions.delete(session.id);
                clearSessionStatus(session.id);
                // Also drop any alias pointing at this session so the
                // next WS under the SDK id creates a fresh empty one
                // rather than resurrecting a partially-torn-down object.
                if (session.claudeSessionId && session.claudeSessionId !== session.id) {
                  const aliased = this.sessions.get(session.claudeSessionId);
                  if (aliased === session) {
                    this.sessions.delete(session.claudeSessionId);
                    clearSessionStatus(session.claudeSessionId);
                  }
                }
              }
            }
          },
          30 * 60 * 1000,
        );
      }
    });
  }

  /** Sliding-window rate limiter. Returns false if the message should be rejected. */
  private checkRateLimit(session: ChatSession): boolean {
    const now = Date.now();
    // Remove timestamps older than 1 second
    session.messageTimestamps = session.messageTimestamps.filter((t) => now - t < 1000);
    if (session.messageTimestamps.length >= WS_RATE_LIMIT) {
      return false;
    }
    session.messageTimestamps.push(now);
    return true;
  }

  /**
   * Public entry point used by the HTTP `/api/chat/send` route to deliver
   * a user message into a chat session. Mirrors the WebSocket "message"
   * handler but with idempotency on `clientMessageId` so a fetch retry
   * (the browser's `keepalive` flag survives navigation but the response
   * may never reach the originating tab) doesn't double-send.
   *
   * Returns:
   *   - { ok: true }                  → queued / processing started
   *   - { ok: true, duplicate: true } → same clientMessageId already seen
   *   - { ok: false, rateLimited }    → too many sends in 1s window
   */
  public enqueueUserMessage(args: {
    sessionId: string;
    text: string;
    clientMessageId: string;
    actorEmail: string;
    sessionCwd?: string | null;
  }): { ok: boolean; duplicate?: boolean; rateLimited?: boolean } {
    const session = this.getOrCreateSession(args.sessionId);
    if (args.actorEmail) session.actorEmail = args.actorEmail;
    if (args.sessionCwd && !session.sessionCwd) session.sessionCwd = args.sessionCwd;

    if (session.recentClientMessageIds.has(args.clientMessageId)) {
      return { ok: true, duplicate: true };
    }
    session.recentClientMessageIds.add(args.clientMessageId);
    if (session.recentClientMessageIds.size > 50) {
      const oldest = session.recentClientMessageIds.values().next().value;
      if (oldest !== undefined) session.recentClientMessageIds.delete(oldest);
    }

    if (!this.checkRateLimit(session)) {
      return { ok: false, rateLimited: true };
    }

    session.lastUserMessage = args.text;
    this.queuePersist(session);
    if (session.isProcessing) {
      session.messageQueue.push({ text: args.text });
    } else {
      this.handleUserMessage(session, args.text);
    }
    return { ok: true };
  }

  private handleMessage(session: ChatSession, _ws: WebSocket, msg: Record<string, unknown>) {
    const type = msg.type as string;

    if (type === "message") {
      const text = msg.text as string;
      // Remember the last user-sent text for post-restart Resume UX.
      session.lastUserMessage = text;
      this.queuePersist(session);
      if (session.isProcessing) {
        session.messageQueue.push({ text });
      } else {
        this.handleUserMessage(session, text);
      }
      return;
    }

    if (type === "permission_response" || type === "ask_response" || type === "plan_response") {
      const id = msg.id as string;
      const resolver = session.pendingRequests.get(id);
      if (resolver) {
        resolver(msg);
        session.pendingRequests.delete(id);
      }
      // Purge the original prompt from eventHistory so a reconnecting
      // client (or another tab) doesn't re-surface an already-answered
      // modal. Without this, every route change / page reload showed
      // the same Bash approval again.
      session.eventHistory = session.eventHistory.filter((e) => {
        const t = e.type;
        if (t !== "permission_request" && t !== "ask_question" && t !== "plan_proposal")
          return true;
        return e.id !== id;
      });
      // Broadcast a resolution marker so other open tabs watching the
      // same session can also drop the prompt from their UI state.
      this.broadcast(session, { type: "permission_resolved", id });
      // Dismiss stale system notifications on all devices when the user
      // responds from any tab. Covers permission, ask, and plan prompts.
      void sendToUser(
        session.actorEmail,
        { title: "", body: "", kind: "permissionRequest", tagKey: session.id, closeOnly: true },
        "permissionRequest",
      );
      void sendToUser(
        session.actorEmail,
        { title: "", body: "", kind: "askQuestion", tagKey: session.id, closeOnly: true },
        "askQuestion",
      );
      void sendToUser(
        session.actorEmail,
        { title: "", body: "", kind: "planProposal", tagKey: session.id, closeOnly: true },
        "planProposal",
      );
      session.accumulatedText = "";
      return;
    }

    if (type === "stop") {
      if (session.isProcessing) {
        // Flag this as a user-initiated stop so the catch block in
        // handleUserMessage doesn't surface the resulting AbortError as
        // a red error bubble — we're already broadcasting a clean
        // "Stopped by user" result below.
        session.userAborted = true;

        // Drain any pending approval/question/plan requests first — the
        // SDK is blocked inside canUseTool waiting for a response that
        // will never come, and the abort won't take effect until
        // canUseTool resolves. Deny-resolve each with an interrupt marker.
        for (const [id, resolve] of session.pendingRequests) {
          resolve({
            allow: false,
            approve: false,
            answers: {},
            message: "Interrupted by user",
          });
          this.broadcast(session, { type: "permission_resolved", id });
        }
        if (session.pendingRequests.size > 0) {
          // Close all pending prompt notifications on every device.
          for (const kind of ["permissionRequest", "askQuestion", "planProposal"] as const) {
            void sendToUser(
              session.actorEmail,
              { title: "", body: "", kind, tagKey: session.id, closeOnly: true },
              kind,
            );
          }
        }
        session.pendingRequests.clear();

        // AbortController is what actually kills the Claude CLI child
        // process — we pass `signal: abortController.signal` into
        // child_process.spawn in spawnClaude, and Node sends SIGTERM on
        // abort. Always call this first, unconditionally.
        session.abortController?.abort();

        // Best-effort graceful SDK interrupt. Only has effect in
        // streaming-input mode (we use single-message mode with `prompt:
        // string`), where it's a no-op. Harmless either way; we already
        // aborted.
        const q = session.currentQuery;
        if (q?.interrupt) {
          q.interrupt().catch(() => {
            /* ignore — the abort above is what matters */
          });
        }

        this.broadcast(session, { type: "result", text: "Stopped by user", isError: false });
        this.setStatus(session, "idle");
        session.messageQueue = [];
      }
      return;
    }

    if (type === "set_effort") {
      // Whitelist the SDK's EffortLevel values; anything else (including
      // "" for Auto) becomes null and the SDK falls back to adaptive
      // thinking.
      const raw = typeof msg.effort === "string" ? msg.effort : "";
      const allowed = new Set(["low", "medium", "high", "xhigh", "max"]);
      session.effort = allowed.has(raw) ? raw : null;
      // Echo back to every connected tab so toolbars stay in sync after a
      // reload or across multi-tab sessions. Mirrors `mode_changed`.
      this.broadcast(session, { type: "effort_changed", effort: session.effort });
      return;
    }

    if (type === "set_model") {
      // Allow only the SDK's stable family aliases. The SDK resolves these
      // to the latest concrete version (e.g. `sonnet` → claude-sonnet-4-6
      // today, claude-sonnet-4-7 tomorrow) so picker values keep working
      // across Anthropic version bumps without a server change. Anything
      // else (including "" for Auto) becomes null and the SDK falls back
      // to its subscription default.
      const raw = typeof msg.model === "string" ? msg.model : "";
      const allowed = new Set(["opus", "sonnet", "haiku"]);
      session.model = allowed.has(raw) ? raw : null;
      // Live mid-turn switch. Without `query.setModel()` the new value
      // only takes effect on the NEXT turn — calling it here lets the
      // currently-running query (if any) pick up the change immediately.
      // Fire-and-forget: session state + UI stay correct even if the
      // SDK call lands after the query has already finished.
      const setModelOnQuery = session.currentQuery?.setModel;
      if (typeof setModelOnQuery === "function") {
        try {
          void setModelOnQuery.call(session.currentQuery, session.model ?? undefined).catch(() => {
            /* SDK rejected — we already updated our own state */
          });
        } catch {
          /* synchronous throw — ignore */
        }
      }
      this.broadcast(session, { type: "model_changed", model: session.model });
      return;
    }

    if (type === "set_mode") {
      this.setSessionMode(session, (msg.mode as string) || "default", "client");
      return;
    }
  }

  /**
   * Update a session's permission mode, broadcast the change to every
   * connected client, and tell the live SDK Query handle to flip its
   * own internal gate. Called both when the client explicitly sends
   * `set_mode` (for multi-tab sync) and when the server changes mode on
   * its own (ExitPlanMode approval).
   *
   * Without the `query.setPermissionMode()` call, the SDK keeps
   * enforcing the previous mode for the rest of the turn — so after
   * plan-approval the agent sees its Bash/Edit calls denied by the
   * SDK's plan-mode gate even though our `session.permissionMode`
   * flipped to `acceptEdits`.
   */
  private setSessionMode(
    session: ChatSession,
    mode: string,
    reason: "client" | "plan_approved",
  ): void {
    session.permissionMode = mode;
    this.broadcast(session, { type: "mode_changed", mode, reason });
    // Fire-and-forget: session state + UI stay correct even if the SDK
    // call can't land (e.g. the Query handle already finished).
    const setPermOnQuery = session.currentQuery?.setPermissionMode;
    if (typeof setPermOnQuery === "function") {
      try {
        void setPermOnQuery.call(session.currentQuery, mode).catch(() => {
          /* SDK rejected — we already updated our own state */
        });
      } catch {
        /* synchronous throw — ignore */
      }
    }
  }

  private async handleUserMessage(session: ChatSession, text: string) {
    // Guard against infinite retry loops from "No conversation found" errors.
    if (session.retryCount > 2) {
      this.broadcast(session, {
        type: "error",
        error: "Conversation resume failed after multiple retries. Please start a new chat.",
      });
      session.retryCount = 0;
      session.isProcessing = false;
      return;
    }

    // Global credential gate — if any session has already hit a 401 / subscription
    // error, block ALL turns immediately and re-surface the auth banner. This
    // prevents new or switched-to sessions from wasting a full SDK turn just to
    // hit the same failure, and is the primary fix for "spawning many broken chats".
    if (this.claudeAuthFailed) {
      // Reset status-store + broadcast status:idle so the sidebar stops showing
      // this session as "thinking" and the client's stop button disappears.
      this.setStatus(session, "idle");
      this.broadcast(session, {
        type: "auth_required",
        provider: "claude",
        reason: this.claudeAuthFailedReason,
        message:
          this.claudeAuthFailedReason === "subscription_expired"
            ? "Your Claude subscription is inactive or has reached its usage limit."
            : "Claude rejected the stored credentials. Your OAuth token has probably expired.",
        hint: this.claudeAuthFailedHint,
      });
      session.isProcessing = false;
      session.messageQueue = [];
      return;
    }

    session.isProcessing = true;
    session.accumulatedText = "";
    if (!session.displayPreview && text.trim().length > 0) {
      session.displayPreview = text.trim().slice(0, 80);
    }
    const abortController = new AbortController();
    session.abortController = abortController;
    // Kick off the status machine for this turn — sidebar dot flips blue
    // the moment the query starts, not only once the first token streams.
    this.setStatus(session, "thinking");
    // Lifecycle anchor for the UI timeline — the client uses this to open
    // a new assistant-turn container before any stream_event arrives.
    const turnId = `turn-${Date.now()}-${++session.requestCounter}`;
    this.broadcast(session, { type: "turn_start", turnId });
    const turnStartedAt = Date.now();
    getAuditWriter()
      .session({
        type: "user_message",
        severity: "info",
        actor: session.actorEmail,
        subject: `User message (${text.length} chars)`,
        durationMs: null,
        sessionId: session.id,
        claudeSessionId: session.claudeSessionId,
        turnId,
        details: { textLength: text.length },
      })
      .catch(() => {});
    let toolInputAccum = "";
    let pendingToolUse: { id: string; name: string } | null = null;

    const getToolDescription = (toolName: string, input: Record<string, unknown>): string => {
      if (toolName === "Bash" && input.command) return (input.command as string).slice(0, 120);
      if (["Read", "Write", "Edit"].includes(toolName) && input.file_path)
        return input.file_path as string;
      if (toolName === "Grep" && input.pattern) return `pattern: ${input.pattern}`;
      if (toolName === "Glob" && input.pattern) return `pattern: ${input.pattern}`;
      return "";
    };

    // Fresh read per-turn so "Agent behavior" settings edits (system prompt
    // + rules) apply on the very next message — matching the loadMcpServers
    // pattern below. Always returns a string; never throws.
    const customAppend = await getCustomAppendForSdk();
    // Pull global memory into the system prompt on every turn. Per-project
    // memory is handled by the SDK's autoMemoryEnabled feature (see boot
    // section); this covers the cross-project, always-on tier.
    const globalMemoryAppend = await getGlobalMemoryAppend();
    const modeAppend =
      session.permissionMode === "plan"
        ? "You are currently in PLAN MODE. Do not run shell commands, " +
          "edit files, or write new files in this turn — the host will " +
          "deny those tool calls. Instead, propose a plan and call " +
          "ExitPlanMode when you are ready for the user to review it."
        : session.permissionMode === "acceptEdits"
          ? "You are in ACCEPT-EDITS MODE. File edits and writes are " +
            "pre-approved; proceed without asking for permission for those " +
            "tools. Shell commands still require explicit approval."
          : "";
    const combinedAppend = [customAppend, globalMemoryAppend, modeAppend]
      .filter(Boolean)
      .join("\n\n");

    const queryOptions: Record<string, unknown> = {
      // Prefer the original cwd from JSONL (for resume to find the session file).
      // Fall back to CLAUDE_CWD env, then homedir() (works cross-platform).
      // `/root` (Docker default) doesn't exist on Windows/Mac and causes spawn ENOENT.
      cwd: session.sessionCwd || process.env.CLAUDE_CWD || homedir(),
      includePartialMessages: true,
      // Adaptive thinking lets Claude allocate reasoning tokens when the
      // problem warrants it. Delivered as thinking_delta stream events,
      // which the UI renders as a collapsible Thinking block. Opt-out
      // with CLAUDE_THINKING=off if the extra tokens cost matter.
      //
      // IMPORTANT: adaptive thinking overrides any explicit `effort`
      // value, so the toolbar's Low/Med/High/Max selector used to be a
      // no-op (every turn ran as "auto"). Only enable adaptive thinking
      // when the user picked "Auto" (session.effort === null).
      ...(session.effort
        ? {}
        : process.env.CLAUDE_THINKING !== "off"
          ? { thinking: { type: "adaptive" } }
          : {}),
      // Pass the mode through to the SDK. Without this, the SDK never
      // exposes the ExitPlanMode tool to Claude when the user chose
      // plan mode — Claude couldn't call it even when asked, and just
      // wrote a prose "plan" into the chat. Also enables SDK-level
      // gating for acceptEdits / bypassPermissions.
      ...(session.permissionMode === "plan"
        ? { permissionMode: "plan" as const }
        : session.permissionMode === "acceptEdits"
          ? { permissionMode: "acceptEdits" as const }
          : session.permissionMode === "bypassPermissions"
            ? {
                permissionMode: "bypassPermissions" as const,
                allowDangerouslySkipPermissions: true,
              }
            : session.permissionMode === "auto"
              ? { permissionMode: "auto" as const }
              : {}),
      canUseTool: async (toolName: string, input: Record<string, unknown>) => {
        // Autonomous cron runs take a short-circuit path: decideCronTool
        // enforces the per-job allowlist, bash-prefix filter, and turn
        // budget — with no interactive prompts at all. Returning here
        // keeps the interactive branches below 100% untouched so the
        // existing chat behavior is byte-identical after this refactor.
        if (session.cronPolicy) {
          const decision = decideCronTool(session.cronPolicy, toolName, input);
          if (decision.behavior === "allow") {
            return { behavior: "allow", updatedInput: decision.updatedInput ?? input };
          }
          return {
            behavior: "deny",
            message: decision.message ?? "Denied by cron policy",
          };
        }

        // Handle AskUserQuestion
        if (toolName === "AskUserQuestion") {
          const id = `req-${SERVER_BOOT_ID}-${++session.requestCounter}`;
          this.broadcast(session, { type: "ask_question", id, questions: input.questions || [] });
          this.setStatus(session, "awaiting_input");
          const chatLabel = chatLabelFor(session);
          const firstQ = Array.isArray(input.questions) ? String(input.questions[0] ?? "") : "";
          const qBody = firstQ.length > 100 ? `${firstQ.slice(0, 97)}…` : firstQ;
          void sendToUser(
            session.actorEmail,
            {
              title: `${chatLabel} has a question`,
              body: qBody || "Claude is waiting for your input.",
              kind: "askQuestion",
              url: navUrls.chat(session.id),
              tagKey: session.id,
              chatId: session.id,
            },
            "askQuestion",
          );
          const response = await this.waitForResponse(session, id);
          this.setStatus(session, "thinking");
          return {
            behavior: "allow",
            updatedInput: { questions: input.questions || [], answers: response.answers || {} },
          };
        }

        // Handle ExitPlanMode — Claude calls this at the end of plan mode to
        // propose its plan. Without a dedicated branch, it falls through to
        // the generic permission modal with the plan stuffed into input JSON,
        // the user can't read it, and even an "Allow" click doesn't switch
        // the session out of plan mode → every subsequent Bash/Edit gets
        // auto-denied → Claude loops until it times out ("fails without
        // reason" in user bug reports). This branch renders a proper plan
        // card on the client and applies the user's chosen mode switch.
        if (toolName === "ExitPlanMode") {
          const id = `req-${SERVER_BOOT_ID}-${++session.requestCounter}`;
          const planText = typeof input.plan === "string" ? input.plan : JSON.stringify(input);
          this.broadcast(session, { type: "plan_proposal", id, plan: planText });
          this.setStatus(session, "awaiting_permission");
          const planChatLabel = chatLabelFor(session);
          const planBody = planText.length > 100 ? `${planText.slice(0, 97)}…` : planText;
          void sendToUser(
            session.actorEmail,
            {
              title: `${planChatLabel} — plan ready for review`,
              body: planBody,
              kind: "planProposal",
              url: navUrls.chat(session.id),
              tagKey: session.id,
              chatId: session.id,
            },
            "planProposal",
          );
          const response = await this.waitForResponse(session, id);
          this.setStatus(session, "thinking");

          const approve = response.approve === true;
          const newMode = typeof response.newMode === "string" ? response.newMode : null;
          if (approve) {
            // Default behaviour after plan approval is to flip into
            // acceptEdits so Claude can actually execute the plan it
            // just proposed; the client can override by sending
            // newMode: "default" | "plan" | "auto" if the user wants
            // different follow-up behaviour.
            const nextMode =
              newMode === "default" ||
              newMode === "plan" ||
              newMode === "acceptEdits" ||
              newMode === "auto"
                ? newMode
                : "acceptEdits";
            // Broadcast so the client toolbar flips to the new mode —
            // without this, the UI stays stuck on Plan Mode even though
            // the agent is now in acceptEdits/auto.
            this.setSessionMode(session, nextMode, "plan_approved");
            return { behavior: "allow", updatedInput: input };
          }
          return {
            behavior: "deny",
            message:
              typeof response.message === "string" && response.message.trim()
                ? response.message
                : "Plan not approved — adjust and try again.",
          };
        }

        // Auto-allow session-approved tools
        if (session.sessionAllowedTools.has(toolName)) {
          return { behavior: "allow", updatedInput: input };
        }

        // Mode-aware auto-approval
        const SAFE_TOOLS = new Set([
          "Read",
          "Glob",
          "Grep",
          "Agent",
          "TaskCreate",
          "TaskUpdate",
          "TaskGet",
          "TaskList",
        ]);
        const EDIT_TOOLS = new Set(["Write", "Edit"]);
        const mode = session.permissionMode;

        if (mode === "acceptEdits" || mode === "auto") {
          // Auto-allow safe tools + edit tools, ask for Bash and others.
          // "auto" mode additionally lets the SDK's native classifier
          // pre-approve calls before they reach canUseTool — when it
          // does intercept us, we mirror acceptEdits semantics so the
          // UX is consistent and we never surprise-execute shell.
          if (SAFE_TOOLS.has(toolName) || EDIT_TOOLS.has(toolName)) {
            return { behavior: "allow", updatedInput: input };
          }
        } else if (mode === "plan") {
          // Read-only: allow safe tools, deny everything else
          if (SAFE_TOOLS.has(toolName)) {
            return { behavior: "allow", updatedInput: input };
          }
          if (EDIT_TOOLS.has(toolName) || toolName === "Bash") {
            return { behavior: "deny", message: "Plan mode: no edits or commands allowed" };
          }
        }

        // Default mode (or tools not auto-handled above): ask the user
        const id = `req-${SERVER_BOOT_ID}-${++session.requestCounter}`;
        const description = getToolDescription(toolName, input);
        this.broadcast(session, { type: "permission_request", id, toolName, input, description });
        this.setStatus(session, "awaiting_permission");
        const chatLabel = chatLabelFor(session);
        const detail = description ? `${toolName}: ${description}` : `${toolName}`;
        void sendToUser(
          session.actorEmail,
          {
            title: `${chatLabel} needs approval`,
            body: detail.length > 100 ? `${detail.slice(0, 97)}…` : detail,
            kind: "permissionRequest",
            url: navUrls.chat(session.id),
            tagKey: session.id,
            chatId: session.id,
          },
          "permissionRequest",
        );
        getAuditWriter()
          .session({
            type: "permission_requested",
            severity: "info",
            actor: session.actorEmail,
            subject: `Permission requested: ${toolName}`,
            durationMs: null,
            sessionId: session.id,
            claudeSessionId: session.claudeSessionId,
            turnId,
            toolName,
            details: { requestId: id },
          })
          .catch(() => {});
        const response = await this.waitForResponse(session, id);
        this.setStatus(session, "tool_running");

        if (response.allow) {
          if (response.allowSession) {
            session.sessionAllowedTools.add(toolName);
          }
          getAuditWriter()
            .session({
              type: "permission_granted",
              severity: "info",
              actor: session.actorEmail,
              subject: `Permission granted: ${toolName}`,
              durationMs: null,
              sessionId: session.id,
              claudeSessionId: session.claudeSessionId,
              turnId,
              toolName,
              details: { requestId: id, allowSession: Boolean(response.allowSession) },
            })
            .catch(() => {});
          return { behavior: "allow", updatedInput: input };
        }
        getAuditWriter()
          .session({
            type: "permission_denied",
            severity: "warn",
            actor: session.actorEmail,
            subject: `Permission denied: ${toolName}`,
            durationMs: null,
            sessionId: session.id,
            claudeSessionId: session.claudeSessionId,
            turnId,
            toolName,
            details: { requestId: id },
          })
          .catch(() => {});
        return { behavior: "deny", message: response.message || "User denied this action" };
      },
      ...(session.effort ? { effort: session.effort } : {}),
      // Per-session model override. `null` → omit the key so the SDK uses
      // its subscription default. Aliases (`opus`/`sonnet`/`haiku`) are
      // resolved by the SDK to the latest concrete version on each call.
      ...(session.model ? { model: session.model } : {}),
      ...(() => {
        // Fresh read per-turn so MCP servers the user just wired up in
        // Settings (Google, Bitbucket, Notion, etc.) land on their very
        // next message instead of after a container restart.
        const current = loadMcpServers();
        return current ? { mcpServers: current } : {};
      })(),
      // Hide Anthropic's hosted Gmail / Drive / Calendar connectors
      // (`claude.ai <Service>`) from the model. The SDK auto-injects
      // them based on subscription state, and they appear alongside
      // our connected `google-workspace-custom` server flagged "Needs
      // authentication" — which causes the model to bail out with
      // "Gmail requires you to authenticate first" instead of calling
      // the workspace-mcp tools that *are* connected. Removing them
      // from disallowedTools eliminates the ambiguity. See
      // src/lib/hosted-mcp-blocklist.ts for the rationale.
      disallowedTools: getDisallowedHostedGoogleMcpTools(),
      // System prompt append. Combines the user's "Agent behavior" settings
      // (custom prompt + concatenated rules from $CLAUDE_CWD/.claude/) with
      // the mode-specific hint that tells Claude whether it's in plan or
      // accept-edits mode. Without the mode hint, canUseTool silently
      // denies Bash/Edit in plan mode but Claude doesn't *know* it's in
      // plan mode, so it can loop "I'll run this command…" → denial → retry.
      ...(combinedAppend
        ? {
            systemPrompt: {
              type: "preset" as const,
              preset: "claude_code" as const,
              append: `\n\n${combinedAppend}`,
            },
          }
        : {}),
      // Load CLAUDE.md + .claude/agents/ + .claude/skills/ from the session's
      // working directory so subagents and skills configured via Settings →
      // Agent apply natively (rules are baked into the append above).
      // 'user' is also loaded so the SDK picks up `autoMemoryEnabled` /
      // `autoDreamEnabled` from `~/.claude/settings.json` (see
      // ensureSdkAutoMemoryEnabled at boot) — that's how per-project memory
      // is turned on without us having to thread it per-call.
      settingSources: ["user", "project"] as const,
      // Always seed the SDK's env with the parent process's full env
      // (so PATH / HOME / locale / NODE_OPTIONS / all the usual chain
      // reach through to the Claude CLI subprocess and the MCP servers
      // it spawns), plus ~/.local/bin prepended to PATH so uvx is
      // findable even when it was installed *after* the chat server
      // started. Previously this block returned `undefined` (or an
      // object with only Atlassian/Trello creds and no PATH) — when
      // that was forwarded to the SDK, the spawned Claude CLI inherited
      // either the parent's env or the bare creds object; if the latter,
      // it lost PATH and `uvx workspace-mcp` failed silently, which is
      // exactly why Gmail tools never appeared after signing in to
      // Google via our custom flow.
      env: (() => {
        const base = augmentPathWithLocalBin();
        const out: NodeJS.ProcessEnv = { ...base };
        // Bitbucket creds no longer live here — they ride along with the
        // `bitbucket` MCP server's own env block in ~/.claude.json
        // (registered by src/lib/atlassian-custom-config.ts). The Jira
        // half of the unified config is still injected as JIRA_* env
        // vars so user-supplied skills/MCPs can read them.
        const atlassian = loadAtlassianCredentials();
        const trello = loadTrelloCredentials();
        if (atlassian?.jira) {
          out.JIRA_URL = `https://${atlassian.jira.siteUrl}`;
          out.JIRA_EMAIL = atlassian.email;
          out.JIRA_API_TOKEN = atlassian.jira.apiToken;
          out.ATLASSIAN_EMAIL = atlassian.email;
        }
        if (trello) {
          out.TRELLO_API_KEY = trello.apiKey;
          out.TRELLO_TOKEN = trello.apiToken;
        }
        return out;
      })(),
      abortController,
      spawnClaudeCodeProcess: spawnClaude,
    };

    const queryParams: Record<string, unknown> = { prompt: text, options: queryOptions };
    const resumeId = session.claudeSessionId;
    if (resumeId) {
      (queryParams.options as Record<string, unknown>).resume = resumeId;
    }

    let turnTimedOut = false;
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    const startInactivityTimer = () => {
      if (this.turnInactivityMs <= 0) return;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        turnTimedOut = true;
        abortController.abort();
      }, this.turnInactivityMs);
    };

    try {
      let messageStream;
      try {
        messageStream = query(queryParams as Parameters<typeof query>[0]);
        // Stash the Query handle so the `stop` client message can call
        // .interrupt() on it for a graceful SDK-level stop, and so the
        // ExitPlanMode approval / client mode switches can call
        // .setPermissionMode() on it to tell the SDK's internal gate to
        // stop enforcing plan mode mid-turn.
        session.currentQuery = messageStream as unknown as {
          interrupt?: () => Promise<void>;
          setPermissionMode?: (mode: string) => Promise<void>;
        };
        // Try to get the first message to detect resume failures early
        const first = await (messageStream as AsyncIterableIterator<unknown>).next();
        if (!first.done) {
          // Process the first message
          const msg = first.value as Record<string, unknown>;
          if (msg.type === "system" && msg.subtype === "init") {
            session.claudeSessionId = msg.session_id as string;
            // Mirror the current status into the newly-known SDK session
            // id so the sidebar — which keys off the SDK id from
            // /api/sessions — picks up the dot immediately instead of
            // waiting for the next setStatus.
            if (session.claudeSessionId !== session.id) {
              setSessionStatus(session.claudeSessionId, session.status);
            }
            // ALIAS: the client is about to receive session_init and
            // will update its URL to the SDK id, which triggers a WS
            // reconnect under the new id. Without this alias that
            // reconnect lands on a brand-new empty session, the
            // in-flight stream keeps going into the old one, and the
            // user sees the turn hang. Aliasing ensures the new WS
            // lands on THIS session.
            this.aliasClaudeSessionId(session);
            this.broadcast(session, { type: "session_init", sessionId: msg.session_id });
            getAuditWriter()
              .session({
                type: "sdk_init",
                severity: "info",
                actor: session.actorEmail,
                subject: `SDK session init ${msg.session_id}`,
                durationMs: null,
                sessionId: session.id,
                claudeSessionId: session.claudeSessionId,
                details: {},
              })
              .catch(() => {});
          }
        }
      } catch (resumeErr) {
        // Resume failed — retry without resume
        const errMsg = resumeErr instanceof Error ? resumeErr.message : "";
        if (errMsg.includes("No conversation found") || errMsg.includes("session")) {
          delete (queryParams.options as Record<string, unknown>).resume;
          session.claudeSessionId = null;
          messageStream = query(queryParams as Parameters<typeof query>[0]);
          session.currentQuery = messageStream as unknown as {
            interrupt?: () => Promise<void>;
            setPermissionMode?: (mode: string) => Promise<void>;
          };
        } else {
          throw resumeErr;
        }
      }

      startInactivityTimer();
      for await (const message of messageStream!) {
        // Bail out immediately if the user hit Stop. The SDK's
        // abortController.abort() kills the subprocess, but the async
        // iterator may still yield buffered messages for a second or two
        // — leaving the turn visibly unresponsive to the user. This
        // check short-circuits the loop the moment a stop arrives.
        if (session.userAborted || abortController.signal.aborted) break;
        startInactivityTimer(); // reset on each SDK event so active tool runs don't time out

        const msg = message as Record<string, unknown>;

        // Session init
        if (msg.type === "system" && msg.subtype === "init") {
          session.claudeSessionId = msg.session_id as string;
          if (session.claudeSessionId !== session.id) {
            setSessionStatus(session.claudeSessionId, session.status);
          }
          // Same alias trick as the probe path — see comment above.
          this.aliasClaudeSessionId(session);
          this.broadcast(session, { type: "session_init", sessionId: msg.session_id });
          getAuditWriter()
            .session({
              type: "sdk_init",
              severity: "info",
              actor: session.actorEmail,
              subject: `SDK session init ${msg.session_id}`,
              durationMs: null,
              sessionId: session.id,
              claudeSessionId: session.claudeSessionId,
              details: {},
            })
            .catch(() => {});
          continue;
        }

        // Compact boundary — SDK compacted the context window. Surface it
        // so the UI can render a divider and refresh context usage; without
        // this, the message falls through silently and the token counter
        // drifts until the next result.
        if (msg.type === "system" && msg.subtype === "compact_boundary") {
          this.broadcast(session, {
            type: "compact_boundary",
            trigger: (msg as Record<string, unknown>).compact_metadata,
          });
          continue;
        }

        // Memory recall — SDK's autoMemoryEnabled supervisor surfaced one
        // or more files into this turn. Broadcast so the UI can render a
        // "Recalled from memory" marker. UI rendering is additive; older
        // clients just ignore the unknown type.
        if (msg.type === "system" && msg.subtype === "memory_recall") {
          this.broadcast(session, {
            type: "memory_recall",
            mode: (msg as Record<string, unknown>).mode,
            memories: (msg as Record<string, unknown>).memories,
          });
          continue;
        }

        // Stream events
        if (msg.type === "stream_event") {
          const event = msg.event as Record<string, unknown>;
          if (!event) continue;

          const eventType = event.type as string;
          const delta = event.delta as Record<string, unknown> | undefined;

          if (eventType === "content_block_delta" && delta?.type === "text_delta") {
            session.accumulatedText += delta.text as string;
            this.broadcast(session, { type: "text_delta", text: delta.text });
            continue;
          }

          if (eventType === "content_block_delta" && delta?.type === "thinking_delta") {
            this.broadcast(session, { type: "thinking_delta", text: delta.thinking });
            continue;
          }

          if (eventType === "content_block_start") {
            const block = event.content_block as Record<string, unknown>;
            if (block?.type === "tool_use") {
              toolInputAccum = "";
              pendingToolUse = { id: block.id as string, name: block.name as string };
            }
            continue;
          }

          if (eventType === "content_block_delta" && delta?.type === "input_json_delta") {
            toolInputAccum += delta.partial_json as string;
            continue;
          }

          if (eventType === "content_block_stop") {
            if (pendingToolUse) {
              let parsedInput: Record<string, unknown> = {};
              try {
                parsedInput = JSON.parse(toolInputAccum);
              } catch {
                /* empty */
              }
              // Remember (id → name + input) so the matching tool_result
              // handler can broadcast `file_changed` for Write/Edit/MultiEdit
              // without having to re-parse the assistant message.
              session.pendingToolInputs.set(pendingToolUse.id, {
                name: pendingToolUse.name,
                input: parsedInput,
              });
              this.broadcast(session, {
                type: "tool_use_start",
                id: pendingToolUse.id,
                name: pendingToolUse.name,
                input: parsedInput,
              });
              getAuditWriter()
                .session({
                  type: "tool_use_start",
                  severity: "info",
                  actor: session.actorEmail,
                  subject: `Tool ${pendingToolUse.name}`,
                  durationMs: null,
                  sessionId: session.id,
                  claudeSessionId: session.claudeSessionId,
                  turnId,
                  toolName: pendingToolUse.name,
                  details: { toolId: pendingToolUse.id, inputKeys: Object.keys(parsedInput) },
                })
                .catch(() => {});
              pendingToolUse = null;
              toolInputAccum = "";
            }
            continue;
          }

          continue;
        }

        // Subscriber rate-limit windows. One event per window type; we
        // merge into session.rateLimits so the HUD always has the full
        // 5h + 7d picture even when only one window changed.
        if (msg.type === "rate_limit_event") {
          // Account-scoped: the 5h / 7d windows are per-Anthropic-account,
          // not per-session. One global cache on disk is the source of
          // truth; the HUD popup fetches it via GET /chat/api/rate-limits.
          // Fire-and-forget — a write failure must not block the turn.
          void applyAccountRateLimitEvent(
            (msg as Record<string, unknown>).rate_limit_info as Record<string, unknown>,
          ).catch(() => {
            /* swallow I/O errors; next event retries */
          });
          continue;
        }

        // Tool results (user messages with tool_result content)
        if (msg.type === "user") {
          const userMsg = msg.message as Record<string, unknown>;
          const content = userMsg?.content;
          if (Array.isArray(content)) {
            for (const item of content) {
              if (item.type === "tool_result") {
                const resultContent =
                  typeof item.content === "string"
                    ? item.content
                    : Array.isArray(item.content)
                      ? item.content.map((c: Record<string, unknown>) => c.text || "").join("")
                      : "";
                this.broadcast(session, {
                  type: "tool_result",
                  id: item.tool_use_id,
                  content: resultContent,
                  isError: item.is_error || false,
                });

                // File-state propagation: when Claude completes a
                // Write/Edit/MultiEdit, fire `file_changed` so any open
                // editor for that path can live-reload (or surface a
                // conflict banner if the user has unsaved edits). The
                // tool_use_id keys back to the input we cached at
                // tool_use_start because the SDK's tool_result message
                // carries no input data.
                const toolUseId = typeof item.tool_use_id === "string" ? item.tool_use_id : null;
                if (toolUseId) {
                  const pending = session.pendingToolInputs.get(toolUseId);
                  if (pending) {
                    session.pendingToolInputs.delete(toolUseId);
                    void this.handleFileMutationToolResult(
                      session,
                      pending,
                      item.is_error === true,
                      turnId,
                    );
                  }
                }
              }
            }
          }
          continue;
        }

        if (msg.type === "assistant") {
          const assistantMsg = msg.message as Record<string, unknown>;
          // Broadcast live context usage from assistant usage field.
          // The assistant.message.usage has input_tokens, cache_read_input_tokens, cache_creation_input_tokens.
          const usage = assistantMsg?.usage as Record<string, number> | undefined;
          const model = typeof assistantMsg?.model === "string" ? assistantMsg.model : undefined;
          // SDKAssistantMessage carries `parent_tool_use_id` set to a
          // non-null string when the message was emitted by a subagent
          // spawned via the Task tool. Subagents always run on Haiku
          // and have their own (200 K) context — without this filter
          // their snapshots leak into the main HUD, surfacing as
          // "model: haiku" in the chat header plus a wrong window cap
          // that inflates the percentage (190 K / 200 K = 95 %).
          const parentToolUseId = (msg as { parent_tool_use_id?: string | null })
            .parent_tool_use_id;
          const isSubagent = typeof parentToolUseId === "string" && parentToolUseId.length > 0;
          if (usage && !isSubagent) {
            this.broadcastAssistantUsage(session, usage, model);
          }
          const content = assistantMsg?.content;

          // Broadcast tool_use_complete for any tool calls in this message.
          // Do NOT short-circuit the stream when the message is pure text:
          // the SDK always emits a `result` message for turn completion, and
          // treating narrative messages as "end of turn" broke plan mode —
          // Claude's post-ExitPlanMode follow-up (and any interstitial "Let
          // me think about this") was interpreted as turn-end, killing the
          // stream before the real work could run.
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "tool_use") {
                this.broadcast(session, {
                  type: "tool_use_complete",
                  id: block.id,
                  name: block.name,
                  input: block.input,
                });
                getAuditWriter()
                  .session({
                    type: "tool_use_complete",
                    severity: "info",
                    actor: session.actorEmail,
                    subject: `Tool ${block.name} complete`,
                    durationMs: null,
                    sessionId: session.id,
                    claudeSessionId: session.claudeSessionId,
                    turnId,
                    toolName: block.name as string,
                    details: {
                      toolId: block.id,
                      inputKeys:
                        block.input && typeof block.input === "object"
                          ? Object.keys(block.input as Record<string, unknown>)
                          : [],
                    },
                  })
                  .catch(() => {});
              }
            }
          }
          continue;
        }

        // Result — turn complete
        if (msg.type === "result") {
          // If resume failed, retry without resume (bounded by retryCount guard)
          if (
            msg.is_error &&
            typeof msg.result === "string" &&
            msg.result.includes("No conversation found")
          ) {
            // Set idle BEFORE clearing claudeSessionId so setStatus() can
            // update the old SDK uuid's status file to "idle". Without this,
            // the alias entry stays "thinking" forever and appears as a ghost
            // session in the sidebar.
            this.setStatus(session, "idle");
            session.claudeSessionId = null;
            // Retry the query without resume
            delete (queryParams.options as Record<string, unknown>).resume;
            session.isProcessing = false;
            session.currentQuery = null;
            session.retryCount += 1;
            this.handleUserMessage(session, text);
            return;
          }
          session.claudeSessionId = msg.session_id as string;
          session.retryCount = 0; // reset on successful result
          // Credentials clearly work — clear the global auth gate so all
          // sessions can send messages again.
          this.claudeAuthFailed = false;
          setRuntimeAuthFailed(false);
          session.accumulatedText = "";
          this.broadcast(session, {
            type: "result",
            text: msg.result || "",
            sessionId: msg.session_id,
            isError: msg.is_error || false,
            subtype: msg.subtype,
            permissionDenials: msg.permission_denials || [],
          });
          // Re-detect the branch in case the agent's run included a
          // checkout — keeps the branch-list chip accurate.
          void this.refreshBranchName(session);
          getAuditWriter()
            .session({
              type: "turn_complete",
              severity: msg.is_error ? "error" : "info",
              actor: session.actorEmail,
              subject: msg.is_error ? `Turn error ${turnId}` : `Turn complete ${turnId}`,
              durationMs: Date.now() - turnStartedAt,
              sessionId: session.id,
              claudeSessionId: session.claudeSessionId,
              turnId,
              isError: Boolean(msg.is_error),
              details: {
                subtype: msg.subtype,
                permissionDenials: msg.permission_denials || [],
              },
            })
            .catch(() => {});
          // Auto-collected memory: schedule a consolidation pass once
          // the session has been idle for `idleMs` (default 60s). The
          // scheduler debounces — multi-turn sessions trigger one pass
          // after the user stops typing. Errors are swallowed so the
          // chat loop is never affected by a slow LLM call here.
          (async () => {
            const cwd = session.sessionCwd;
            const claudeSessionId = session.claudeSessionId;
            if (!cwd || !claudeSessionId) return;
            const config = await loadAutoMemoryConfig().catch(() => null);
            if (!config || !config.enabled) return;
            const transcriptPath = join(
              homedir(),
              ".claude",
              "projects",
              sanitizeCwdForClaude(cwd),
              `${claudeSessionId}.jsonl`,
            );
            consolidationScheduler.schedule(session.id, transcriptPath, config.idleMs);
          })().catch(() => {});
          // Web Push: notify subscribed devices that the turn finished.
          // Errors fire on the "error" channel instead so users can opt
          // out of one without losing the other.
          const chatLabel = chatLabelFor(session);
          if (msg.is_error) {
            void sendToUser(
              session.actorEmail,
              {
                title: `${chatLabel} — error`,
                body: "The turn ended with an error. Open the chat to see details.",
                kind: "error",
                url: navUrls.chat(session.id),
                tagKey: session.id,
                chatId: session.id,
              },
              "error",
            );
          } else {
            void sendToUser(
              session.actorEmail,
              {
                title: `${chatLabel} — finished`,
                body: "Ready for your next message.",
                kind: "turnComplete",
                url: navUrls.chat(session.id),
                tagKey: session.id,
                chatId: session.id,
              },
              "turnComplete",
            );
          }
          this.broadcast(session, {
            type: "turn_end",
            turnId,
            isError: msg.is_error || false,
            subtype: msg.subtype,
          });
          this.broadcastContextUsage(session, msg.modelUsage);
          // Clear event history after turn completes — JSONL has the persisted record
          session.eventHistory = [];
          // Notify an awaiting cron runner that the turn reached its
          // terminal result. The sidecar write happens in the runner,
          // so we pass through everything it needs to finalize.
          if (session.cronOnComplete) {
            session.cronOnComplete({
              claudeSessionId: session.claudeSessionId,
              turnsUsed: 0,
              toolCallsCount: 0,
              denials: [],
              tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
              isError: Boolean(msg.is_error),
              errorMessage: msg.is_error
                ? typeof msg.result === "string"
                  ? msg.result
                  : "Run ended with error"
                : undefined,
            });
          }
          continue;
        }

        // Unknown message type — log and continue. Without this fallthrough
        // a new SDK message kind would silently disappear. Exhaustive
        // handling keeps the stream loop debuggable as the SDK evolves.
        if (process.env.DEBUG_SDK_STREAM) {
          console.log(
            `[session=${session.id}] Unhandled SDK message:`,
            msg.type,
            (msg as Record<string, unknown>).subtype,
          );
        }
      }

      // for-await exited normally (iterator done or `break`).
      // Clear the inactivity timer and, if we timed out, broadcast a
      // friendly message before the post-catch cleanup runs.
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
      if (turnTimedOut && !session.userAborted) {
        // Drain the queue and clear stale event history before broadcasting.
        // Without this, messages queued while the turn was hung (e.g. the
        // user clicking Send again out of frustration) would immediately
        // restart a new turn against an API that is still unreachable,
        // creating an infinite stop-restart loop.
        session.messageQueue = [];
        session.eventHistory = [];
        const secs = Math.round(this.turnInactivityMs / 1000);
        this.broadcast(session, {
          type: "error",
          message: `Claude did not respond for ${secs} seconds. The Anthropic API may be temporarily unreachable — please try again.`,
        });
      }
    } catch (err) {
      // Clear the inactivity timer regardless of which error path we take.
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
      // User asked us to stop — the resulting AbortError / killed-child
      // error is expected, not a failure. Swallow the whole error path;
      // the stop handler already broadcast a clean "Stopped by user"
      // result and flipped the session to idle.
      if (session.userAborted) {
        // Fall through to the post-catch cleanup at the bottom of this
        // method, which resets isProcessing / abortController /
        // currentQuery and processes the next queued message (if any).
      } else if (turnTimedOut) {
        // Inactivity timeout fired — abortController.abort() caused the
        // async iterator to reject. Drain the queue and clear event history
        // for the same reason as the normal-exit path above, then broadcast.
        session.messageQueue = [];
        session.eventHistory = [];
        const secs = Math.round(this.turnInactivityMs / 1000);
        this.broadcast(session, {
          type: "error",
          message: `Claude did not respond for ${secs} seconds. The Anthropic API may be temporarily unreachable — please try again.`,
        });
      } else {
        const rawMessage = err instanceof Error ? err.message : "Unknown error";
        const errnoErr = err as NodeJS.ErrnoException;
        const lowered = rawMessage.toLowerCase();

        // Detect Anthropic / Claude-Code auth failures specifically. The
        // SDK surfaces these as a plain Error whose message contains the
        // JSON body from api.anthropic.com — something like:
        //   API Error: 401 {"type":"error","error":{
        //       "type":"authentication_error",
        //       "message":"Invalid authentication credentials"}}
        // When we see that shape, emit a dedicated auth-required event so
        // the UI can pop the "sign in to Claude" flow instead of showing
        // the raw 401 blob as a generic error bubble.
        //
        // Computed BEFORE the resume-retry branch below so that expired
        // credentials never trigger an infinite "open new chat and retry"
        // loop — the SDK wraps 401 responses in a "query returned an
        // error result" envelope that would otherwise match the regex.
        const authError =
          lowered.includes("authentication_error") ||
          lowered.includes("invalid authentication credentials") ||
          lowered.includes("failed to authenticate") ||
          /\b401\b/.test(rawMessage) ||
          lowered.includes("unauthorized");

        // Resume-not-found surfaces here when the SDK throws DURING the
        // for-await loop (rather than yielding a result message with
        // is_error=true). Recover by wiping claudeSessionId and rerunning
        // handleUserMessage — the user sees one spinner cycle, not a
        // cryptic "No conversation found" error bubble. Skip for auth
        // failures: retrying with a fresh conversation just re-hits the
        // same 401 and spawns ghost chats until retryCount > 2.
        if (
          !authError &&
          (lowered.includes("no conversation found") ||
            /returned an error result/i.test(rawMessage))
        ) {
          // Same fix as the result path above: update the old sdk-uuid's
          // status file to "idle" BEFORE wiping claudeSessionId, so the
          // alias entry doesn't stay "thinking" in the sidebar.
          // Also increment retryCount so the guard at the top of
          // handleUserMessage bounds this path (was missing here).
          this.setStatus(session, "idle");
          session.claudeSessionId = null;
          delete (queryParams.options as Record<string, unknown>).resume;
          session.isProcessing = false;
          session.abortController = null;
          session.currentQuery = null;
          session.retryCount += 1;
          this.handleUserMessage(session, text);
          return;
        }

        session.accumulatedText = "";
        // Dump the full error to the container log so operators have
        // errno/code/syscall/path/stack. This app runs in a single-user
        // trusted context — hiding paths behind 'Internal server error'
        // bought us nothing except days of debugging last time.
        console.error(`[session=${session.id}] Query error:`, {
          message: rawMessage,
          errno: errnoErr.errno,
          code: errnoErr.code,
          syscall: errnoErr.syscall,
          path: errnoErr.path,
          stack: errnoErr.stack,
        });

        // Treat ENOENT / EACCES / executable-not-found as "setup required"
        // so the UI can nudge the user towards reinstalling instead of
        // showing a generic error.
        const setupRequired =
          errnoErr.code === "ENOENT" ||
          errnoErr.code === "EACCES" ||
          lowered.includes("executable not found") ||
          lowered.includes("native binary not found") ||
          lowered.includes("no such file");

        // Distinguish a subscription/billing problem from a plain token expiry
        // so the UI can show a "check your plan" message instead of "sign in again".
        const subscriptionError =
          authError &&
          (lowered.includes("inactive subscription") ||
            lowered.includes("subscription_inactive") ||
            lowered.includes("quota_exceeded") ||
            (lowered.includes("billing") && lowered.includes("error")) ||
            (lowered.includes("usage") && lowered.includes("limit")));

        const stderrTail =
          typeof (errnoErr as unknown as { stderr?: string }).stderr === "string"
            ? (errnoErr as unknown as { stderr: string }).stderr
                .trim()
                .split(/\r?\n/)
                .slice(-10)
                .join("\n")
            : undefined;

        getAuditWriter()
          .session({
            type: "error",
            severity: "error",
            actor: session.actorEmail,
            subject: authError
              ? "Claude session auth error"
              : setupRequired
                ? "Claude setup error"
                : "Claude session error",
            durationMs: Date.now() - turnStartedAt,
            sessionId: session.id,
            claudeSessionId: session.claudeSessionId,
            turnId,
            isError: true,
            details: { errorCode: errnoErr.code ?? null, message: rawMessage },
          })
          .catch(() => {});
        void sendToUser(
          session.actorEmail,
          {
            title: authError
              ? `${chatLabelFor(session)} — sign in again`
              : setupRequired
                ? `${chatLabelFor(session)} — setup error`
                : `${chatLabelFor(session)} — error`,
            body: rawMessage.slice(0, 120),
            kind: "error",
            url: navUrls.chat(session.id),
            tagKey: session.id,
            chatId: session.id,
          },
          "error",
        );

        if (authError) {
          // Drain the queue and clear stale event-history so reconnecting
          // clients don't replay a dangling turn_start and show ghost content.
          session.messageQueue = [];
          session.eventHistory = [];
          // Set the global gate so ALL subsequent turns — including turns in
          // new or switched-to sessions — are blocked until credentials are
          // restored. This is the primary fix for "spawning many broken chats".
          this.claudeAuthFailed = true;
          this.claudeAuthFailedReason = subscriptionError
            ? "subscription_expired"
            : "token_expired";
          // Mirror to the module singleton so /api/claude-auth/status can
          // report the live failure state to the Settings page.
          setRuntimeAuthFailed(true, this.claudeAuthFailedReason);
          this.claudeAuthFailedHint = subscriptionError
            ? "Check your plan at claude.ai/settings/billing."
            : "Run `claude auth login` in the container terminal, or click below.";
          this.broadcast(session, {
            type: "auth_required",
            provider: "claude",
            reason: this.claudeAuthFailedReason,
            message: subscriptionError
              ? "Your Claude subscription is inactive or has reached its usage limit."
              : "Claude rejected the stored credentials (HTTP 401). Your OAuth " +
                "token has probably expired — sign in again to keep chatting.",
            hint: this.claudeAuthFailedHint,
          });
        } else if (setupRequired) {
          this.broadcast(session, {
            type: "setup_required",
            message:
              "Claude SDK could not be started. The bundled sdk.mjs may be missing or unreachable. " +
              `Raw error: ${rawMessage}` +
              (errnoErr.path ? ` (path=${errnoErr.path})` : ""),
            ...(stderrTail ? { stderrTail } : {}),
          });
        } else {
          this.broadcast(session, {
            type: "error",
            message: rawMessage,
            ...(errnoErr.code ? { errorCode: errnoErr.code } : {}),
            ...(stderrTail ? { stderrTail } : {}),
          });
        }
      } // end `else` — non-userAborted error path
    }

    // Safety-net: ensure the inactivity timer never outlives the turn.
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
    session.isProcessing = false;
    session.abortController = null;
    session.currentQuery = null;
    // Reset the one-shot abort flag so the next turn starts fresh.
    session.userAborted = false;
    // Turn is done — flip the dot off. If a queued message starts next,
    // handleUserMessage() will flip it straight back to "thinking".
    this.setStatus(session, "idle");

    // If a cron run is still awaiting resolution (e.g. the stream ended
    // without emitting a result event — abort, spawn failure, etc.),
    // settle with an error so the runner doesn't hang forever.
    if (session.cronOnComplete) {
      session.cronOnComplete({
        claudeSessionId: session.claudeSessionId,
        turnsUsed: 0,
        toolCallsCount: 0,
        denials: [],
        tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
        isError: true,
        errorMessage: "Run ended without a terminal result event",
      });
    }

    // Process queued messages
    if (session.messageQueue.length > 0) {
      const next = session.messageQueue.shift()!;
      this.handleUserMessage(session, next.text);
    }
  }

  /**
   * Wait for a client response (permission or question answer) with timeout.
   * Auto-denies if no response is received within RESPONSE_TIMEOUT_MS.
   */
  private waitForResponse(session: ChatSession, id: string): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      // RESPONSE_TIMEOUT_MS <= 0 disables the safety timer completely —
      // the promise only resolves when a real permission_response /
      // ask_response / plan_response arrives. Useful for fully
      // background workflows where the user may not check back for
      // hours (or days) and we never want to auto-deny silently.
      const timer =
        RESPONSE_TIMEOUT_MS > 0
          ? setTimeout(() => {
              session.pendingRequests.delete(id);
              console.warn(`[session=${session.id}] Response timeout for request ${id}`);
              this.setStatus(session, "thinking");
              resolve({ allow: false, message: "Response timed out", answers: {} });
            }, RESPONSE_TIMEOUT_MS)
          : null;

      session.pendingRequests.set(id, (response) => {
        if (timer) clearTimeout(timer);
        resolve(response);
      });
    });
  }

  /**
   * Event types that carry structural replay value. High-frequency streaming
   * events (text_delta, thinking_delta, tool_use_start, tool_result) are
   * excluded so eventHistory doesn't fill up during a long turn and get
   * pruned before the important bookmarks (turn_start/end, result, etc.)
   * are preserved.
   */
  private static readonly HISTORY_EVENT_TYPES = new Set([
    "session_init",
    "turn_start",
    "turn_end",
    "result",
    "permission_request",
    "permission_resolved",
    "ask_question",
    "plan_proposal",
    "interrupted",
    "error",
  ]);

  private broadcast(session: ChatSession, event: Record<string, unknown>) {
    session.lastActivity = Date.now();

    // Save to history for reconnecting clients — store only structural
    // events needed for replay, skip high-frequency streaming events
    // (text_delta, thinking_delta, tool_use_start, tool_result, status).
    const eventType = event.type as string;
    if (SessionManager.HISTORY_EVENT_TYPES.has(eventType)) {
      session.eventHistory.push(event);
      // Cap history to prevent unbounded growth (keep last 500 events)
      if (session.eventHistory.length > 500) {
        session.eventHistory = session.eventHistory.slice(-500);
      }
      // Persist only on meaningful mutations. status is already handled
      // by setStatus(); every other event that mutates eventHistory
      // ends up here. Coalesced via queuePersist so a burst of tokens
      // writes once per microtask.
      this.queuePersist(session);
    }

    // Tee into the cron run log if this session is an autonomous run.
    // Errors in the hook are deliberately swallowed — a failing log
    // writer must never break the SDK stream.
    if (session.cronOnEvent) {
      try {
        session.cronOnEvent(event);
      } catch {
        /* ignore */
      }
    }

    const data = JSON.stringify(event);
    const bytes = Buffer.byteLength(data, "utf-8");
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
        wsRecordOutgoing(session.id, bytes);
      }
    }
    wsUpdateSession(session.id, {
      queueDepth: session.messageQueue.length,
      pendingRequests: session.pendingRequests.size,
      lastActivityAt: Date.now(),
    });
  }

  private send(ws: WebSocket, event: Record<string, unknown>) {
    if (ws.readyState === WebSocket.OPEN) {
      const data = JSON.stringify(event);
      ws.send(data);
    }
  }

  /**
   * Broadcast a `file_changed` event when Claude completes a Write,
   * Edit, or MultiEdit so an open editor can live-reload (or surface
   * a conflict banner if the user has unsaved local edits).
   *
   * Path is canonicalized via safePath() so the editor — which uses
   * the same realpath identity from `/api/files/read` — sees a
   * matching subscription key. Stat failures (e.g. Claude wrote then
   * deleted in the same turn) emit `{ deleted: true, mtimeMs: null }`
   * rather than dropping the event.
   *
   * Tool errors (`isError`) skip the broadcast — a failed Write didn't
   * change anything on disk so there's nothing to reload.
   */
  private async handleFileMutationToolResult(
    session: ChatSession,
    pending: { name: string; input: Record<string, unknown> },
    isError: boolean,
    turnId: string,
  ): Promise<void> {
    if (isError) return;
    const FILE_MUTATING_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
    if (!FILE_MUTATING_TOOLS.has(pending.name)) return;
    const rawPath = pending.input.file_path;
    if (typeof rawPath !== "string" || rawPath.length === 0) return;

    let canonical: string;
    try {
      canonical = await safePath(rawPath);
    } catch (err) {
      if (err instanceof SafePathError) return;
      // Path that doesn't exist (e.g. Write to a brand new file's
      // parent dir that doesn't exist either) shouldn't reach here
      // because the SDK would have errored, but stay defensive.
      return;
    }

    let mtimeMs: number | null = null;
    let deleted = false;
    try {
      const s = await stat(canonical);
      mtimeMs = s.mtimeMs;
    } catch {
      deleted = true;
    }

    this.broadcast(session, {
      type: "file_changed",
      path: canonical,
      mtimeMs,
      source: "claude",
      tool: pending.name,
      deleted,
    });
    getAuditWriter()
      .session({
        type: "file_changed",
        severity: "info",
        actor: session.actorEmail,
        subject: `File ${deleted ? "deleted" : "changed"} by ${pending.name}`,
        durationMs: null,
        sessionId: session.id,
        claudeSessionId: session.claudeSessionId,
        turnId,
        toolName: pending.name,
        details: { path: canonical, deleted },
      })
      .catch(() => {});
  }

  /**
   * Cache the authoritative context-window size from a turn-end `result`
   * event. We **do not** broadcast a context_usage event from this path:
   * `result.modelUsage[modelId]` aggregates token counts cumulatively
   * across every assistant chunk in the turn (a 10-step turn with a
   * 250 K cached prompt sums to ~2.5 M, blowing past the actual window).
   * Using those values as "context used" was the cause of the
   * "1253 % of 1 M" bug.
   *
   * Instead, the per-message broadcaster (`broadcastAssistantUsage`)
   * emits the latest snapshot — that's the right number. This method
   * only learns the model's true window cap so the next snapshot's
   * `max` is accurate (e.g. 200 K for a 200K model rather than the
   * default 1 M fallback).
   */
  private broadcastContextUsage(session: ChatSession, modelUsage: unknown): void {
    // Hint the picker with the most recent main-thread assistant model
    // (subagent messages are filtered out before they reach
    // `lastModelId`, so this is always the user's actual model). This
    // ensures the cap matches the active model — without it, the picker
    // would fall back to the largest-window entry, which is *usually*
    // right but not guaranteed.
    const window = extractContextWindow(modelUsage, session.lastModelId ?? null);
    if (!window) return;
    session.lastContextWindow = window.contextWindow;
    session.lastModelId = window.model;
  }

  /** Broadcast live context usage from an assistant message's `usage` field. */
  private broadcastAssistantUsage(
    session: ChatSession,
    usage: Record<string, number>,
    model?: string,
  ): void {
    // Accumulate for cron token accounting — the sidecar stores the
    // total at run-end, not per-message. Out-of-band of any broadcast.
    if (session.cronPolicy) {
      session.cronTokenUsage.input += usage.input_tokens || 0;
      session.cronTokenUsage.output += usage.output_tokens || 0;
      session.cronTokenUsage.cacheRead += usage.cache_read_input_tokens || 0;
      session.cronTokenUsage.cacheCreate += usage.cache_creation_input_tokens || 0;
    }

    const snapshot = snapshotFromAssistantUsage(
      usage,
      model ?? session.lastModelId ?? null,
      session.lastContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    );
    if (snapshot.used === 0) return;

    this.broadcast(session, {
      type: "context_usage",
      used: snapshot.used,
      max: snapshot.max,
      percentage: snapshot.percentage,
      model: snapshot.model,
      inputTokens: snapshot.inputTokens,
      outputTokens: snapshot.outputTokens,
      cacheReadTokens: snapshot.cacheReadTokens,
      cacheCreateTokens: snapshot.cacheCreateTokens,
    });
  }

  /**
   * Drive one autonomous run through the existing SDK pipeline. Sets up
   * session.cronPolicy so canUseTool takes the allowlist path, then calls
   * handleUserMessage and returns a promise that resolves when the SDK
   * emits its terminal result (or errors out).
   */
  runCron(args: {
    sessionId: string;
    prompt: string;
    cwd: string;
    allowedTools: string[];
    allowedBashPrefixes: string[];
    maxTurns: number;
    maxDurationSec: number;
    onEvent?: (event: Record<string, unknown>) => void;
  }): Promise<CronRunOutcome> {
    const session = this.getOrCreateSession(args.sessionId);
    session.sessionCwd = args.cwd;
    session.cronTokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
    session.cronOnEvent = args.onEvent ?? null;
    session.cronPolicy = {
      kind: "cron",
      allowed: args.allowedTools,
      allowedBashPrefixes: args.allowedBashPrefixes,
      turnBudget: { remaining: args.maxTurns },
      denials: [],
    };

    return new Promise<CronRunOutcome>((resolve) => {
      let settled = false;
      const settle = (outcome: CronRunOutcome) => {
        if (settled) return;
        settled = true;
        if (session.cronAbortTimer) {
          clearTimeout(session.cronAbortTimer);
          session.cronAbortTimer = null;
        }
        const policy = session.cronPolicy;
        session.cronPolicy = null;
        session.cronOnComplete = null;
        session.cronOnEvent = null;
        resolve({
          ...outcome,
          denials: policy ? [...policy.denials] : outcome.denials,
          turnsUsed: policy ? args.maxTurns - policy.turnBudget.remaining : outcome.turnsUsed,
          tokenUsage: { ...session.cronTokenUsage },
        });
      };

      session.cronOnComplete = settle;

      // Wall-clock safety: abort if the SDK stream runs past maxDurationSec.
      session.cronAbortTimer = setTimeout(
        () => {
          try {
            const q = session.currentQuery;
            if (q?.interrupt) {
              q.interrupt().catch(() => session.abortController?.abort());
            } else {
              session.abortController?.abort();
            }
          } catch {
            /* best-effort abort */
          }
        },
        Math.max(1, args.maxDurationSec) * 1000,
      );

      this.handleUserMessage(session, args.prompt);
    });
  }

  /**
   * Force-disconnect every WebSocket attached to a session. Used by the
   * monitoring "Disconnect" admin action.
   */
  forceDisconnect(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    for (const client of session.clients) {
      try {
        client.close(1000, "Force-disconnected by operator");
      } catch {
        /* already dead */
      }
    }
    return true;
  }
}

/* ------------------------------------------------------------------ */
/*  Terminal (PTY over WebSocket)                                      */
/* ------------------------------------------------------------------ */

/**
 * Wire up a fresh interactive shell over a WebSocket.
 * The client streams raw stdin bytes as text frames; JSON control frames
 * ({type:"resize",cols,rows} / {type:"close"}) are handled specially.
 */
function handleTerminalConnection(ws: WebSocket, email: string): void {
  let pty: import("node-pty").IPty | null = null;
  try {
    const { shell, args } = resolveShell();
    const lib = loadPty();
    pty = lib.spawn(shell, args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.env.CLAUDE_CWD || homedir(),
      env: process.env as Record<string, string>,
    });
    console.log(`[terminal] opened (${email}) using ${shell}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start terminal";
    try {
      ws.send(`\r\n\x1b[31m[terminal] ${msg}\x1b[0m\r\n`);
    } catch {
      /* socket already dead */
    }
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    return;
  }

  pty.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(data);
      } catch {
        /* closing */
      }
    }
  });

  pty.onExit(() => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });

  ws.on("message", (raw) => {
    const str = raw.toString();
    // Try to parse as a JSON control message first; fall back to raw stdin.
    if (str.length > 0 && str[0] === "{") {
      try {
        const msg = JSON.parse(str) as { type?: string; cols?: number; rows?: number };
        if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
          pty?.resize(Math.max(1, msg.cols | 0), Math.max(1, msg.rows | 0));
          return;
        }
        if (msg.type === "close") {
          pty?.kill();
          return;
        }
      } catch {
        /* not JSON — treat as stdin */
      }
    }
    pty?.write(str);
  });

  ws.on("close", () => {
    console.log(`[terminal] closed (${email})`);
    try {
      pty?.kill();
    } catch {
      /* already dead */
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Origin validation                                                  */
/* ------------------------------------------------------------------ */

function isOriginAllowed(origin: string | undefined): boolean {
  // In dev mode, allow all origins
  if (dev) return true;

  // No origin header — could be a same-origin request or non-browser client
  if (!origin) return true;

  // Check explicit allowlist
  if (ALLOWED_ORIGINS.size > 0) {
    return ALLOWED_ORIGINS.has(origin);
  }

  // Production with no allowlist: reject all cross-origin connections.
  // A startup warning is logged at boot (see ALLOWED_ORIGINS check below).
  return false;
}

/* ------------------------------------------------------------------ */
/*  Start                                                              */
/* ------------------------------------------------------------------ */

const app = next({ dev });
const handle = app.getRequestHandler();
const sessionManager = new SessionManager();
// Publish the SessionManager via a module-level singleton so API routes
// can reach it even when the scheduler hasn't finished booting. This was
// the root cause of the "Run Now" 503s: the scheduler singleton was the
// only handle API routes had, and any transient bootstrap failure made
// manual runs unrunnable.
setSessionManager(sessionManager);
// Same trick for the HTTP /api/chat/send route — gives it a way to call
// SessionManager.enqueueUserMessage without importing server.ts (which
// would create a build cycle).
setChatSendHandle({
  enqueueUserMessage: sessionManager.enqueueUserMessage.bind(sessionManager),
});

// Expose force-disconnect for the monitoring admin API. Anchored on
// globalThis so the bundled API route module can reach it across the
// Next.js standalone module boundary.
(
  globalThis as { __clawForceDisconnectSession?: (id: string) => boolean }
).__clawForceDisconnectSession = (id: string) => sessionManager.forceDisconnect(id);

// Expose a slim per-session view (with branchName) so the
// /api/sessions/branches route can mark active chats in the branch list.
(
  globalThis as {
    __clawListSessionBranches?: () => ReturnType<typeof sessionManager.listBranchSnapshots>;
  }
).__clawListSessionBranches = () => sessionManager.listBranchSnapshots();

// Rehydrate session state from disk so a container restart doesn't
// wipe every in-flight conversation. Runs synchronously (well, fire
// and log) before we start listening — if it fails we still come up,
// just with an empty session set.
(async () => {
  try {
    const persisted = await loadAllSessions();
    for (const p of persisted) {
      sessionManager.restoreFromDisk(p);
    }
    if (persisted.length > 0) {
      console.log(`> Restored ${persisted.length} chat session(s) from disk`);
    }
  } catch (err) {
    console.warn(`!! Could not rehydrate sessions: ${(err as Error).message}`);
  }
})();

// Bootstrap the reports scheduler. Sibling IIFE so a scheduler failure
// (e.g. corrupt .jobs/ directory) doesn't block chat from coming up.
(async () => {
  try {
    const scheduler = new ReportScheduler(sessionManager);
    setScheduler(scheduler);
    await scheduler.bootstrap();
  } catch (err) {
    console.warn(`!! Could not start reports scheduler: ${(err as Error).message}`);
  }
})();

// Ensure the projects root exists so the Projects API doesn't 500 on a
// fresh install. Sibling IIFE for the same isolation reason as above.
(async () => {
  try {
    await ensureProjectsTree();
  } catch (err) {
    console.warn(`!! Could not init projects tree: ${(err as Error).message}`);
  }
})();

// Memory subsystem boot:
//   - ensure /root/.memory/global exists for the global-memory injector
//   - patch ~/.claude/settings.json so the Agent SDK's autoMemoryEnabled +
//     autoDreamEnabled flags are on (settingSources includes 'user' so the
//     SDK actually sees these on every query)
//   - migrate any existing Agent → System Prompt + Rules content into
//     /root/.memory/global/ (Phase 2 IA absorption — idempotent, never
//     deletes the originals)
(async () => {
  try {
    await ensureMemoryTree();
    await ensureSdkAutoMemoryEnabled();
    const summary = await migrateAgentConfigToMemory();
    if (summary.instructionsCopied || summary.rulesCopied > 0) {
      console.log(
        `[memory] migrated agent-config → memory: ` +
          `instructions=${summary.instructionsCopied ? "yes" : "no"}, ` +
          `rules copied=${summary.rulesCopied} skipped=${summary.rulesSkipped}` +
          (summary.errors.length ? `, errors=${summary.errors.length}` : ""),
      );
    }
    // Sweep stub session JSONLs the consolidator may have left behind in
    // a previous run that crashed before its post-run cleanup fired.
    // Without this, every restart starts with the previous orphans
    // showing up in the chat sidebar's "Recents" as empty
    // "New conversation" entries.
    await rm(consolidatorClaudeProjectsDir(), { recursive: true, force: true }).catch(() => {});
  } catch (err) {
    console.warn(`!! Could not init memory subsystem: ${(err as Error).message}`);
  }
})();

// Auto-collected memory consolidator. Singleton scheduler that owns a
// per-session debounce timer; SessionManager.schedule() is called from
// the turn_complete handler below.
const consolidationScheduler = new ConsolidationScheduler();

// Bootstrap the audit log: ensure /root/.audit exists, run a one-shot
// purge to sweep anything past retention that lingered through a crash,
// then schedule a 6-hour recurring purge so we don't drift out of
// retention while the container keeps running.
(async () => {
  try {
    await ensureAuditTree();
    await purgeOldAuditFiles();
    cron.schedule(
      "0 */6 * * *",
      () => {
        purgeOldAuditFiles().catch((err) => {
          console.warn(`[audit] scheduled purge failed: ${(err as Error).message}`);
        });
      },
      { timezone: "UTC" },
    );
    console.log(`> Audit log ready at /root/.audit (30-day retention)`);
  } catch (err) {
    console.warn(`!! Could not initialize audit log: ${(err as Error).message}`);
  }
})();

// Bootstrap monitoring subsystem (collectors, alert engine, /ws/monitoring
// broadcaster). Independent of audit init; failures are non-fatal.
(() => {
  try {
    bootstrapMonitoring();
  } catch (err) {
    console.warn(`!! Could not initialize monitoring: ${(err as Error).message}`);
  }
})();

// One-shot migration: rewrite legacy `--tool-tier` args in ~/.claude.json
// for users who connected the Google Workspace MCP before we expanded the
// tool set. Idempotent; non-fatal on error.
(async () => {
  try {
    const result = await migrateGoogleMcpTier();
    if (result.migrated) {
      console.log(`> Google MCP tier migrated: ${result.oldTier} → complete`);
    }
  } catch (err) {
    console.warn(`!! Google MCP tier migration skipped: ${(err as Error).message}`);
  }
})();

// One-shot migration: merge legacy ~/.claude/custom-jira/credentials.json
// + ~/.claude/custom-bitbucket/credentials.json into the unified
// ~/.claude/custom-atlassian/credentials.json the first time the server
// starts after the Atlassian unification ships. Idempotent (no-op if
// the unified file already exists); non-fatal on error.
(async () => {
  try {
    const migrated = await migrateAtlassianLegacy();
    if (migrated) {
      const halves = [migrated.jira ? "Jira" : null, migrated.bitbucket ? "Bitbucket" : null]
        .filter(Boolean)
        .join(" + ");
      console.log(`> Atlassian credentials migrated to unified config (${halves})`);
    }
  } catch (err) {
    console.warn(`!! Atlassian credential migration skipped: ${(err as Error).message}`);
  }
})();

// Preview proxy caches (unfurl metadata + external images). Boot-time sweep
// + recurring 12h trim so /root/.cache doesn't grow without bound.
(async () => {
  try {
    await Promise.all([purgeOldUnfurls(), purgeOldImages()]);
    cron.schedule(
      "30 */12 * * *",
      () => {
        purgeOldUnfurls().catch((err) => {
          console.warn(`[preview] unfurl cache purge failed: ${(err as Error).message}`);
        });
        purgeOldImages().catch((err) => {
          console.warn(`[preview] image cache purge failed: ${(err as Error).message}`);
        });
      },
      { timezone: "UTC" },
    );
    console.log(`> Preview caches ready at /root/.cache (unfurl 24h, images 7d)`);
  } catch (err) {
    console.warn(`!! Could not initialize preview caches: ${(err as Error).message}`);
  }
})();

// Phase 3c (#128): per-WS preview file uploads land at
// /root/.cache/preview-uploads/<dropId>-<filename>. The handler
// schedules a setTimeout to unlink each file 60 s after the drop
// completes; this cron is the safety net for files orphaned by
// crashed / hard-killed processes that never reached that timer.
(async () => {
  try {
    await sweepStaleDrops();
    cron.schedule(
      "*/5 * * * *",
      () => {
        sweepStaleDrops().catch((err) => {
          console.warn(`[preview] file-drop sweeper failed: ${(err as Error).message}`);
        });
      },
      { timezone: "UTC" },
    );
    console.log(`> Preview file-drop sweeper scheduled (every 5 min, 60 s TTL)`);
  } catch (err) {
    console.warn(`!! Could not initialize file-drop sweeper: ${(err as Error).message}`);
  }
})();

// Phase 3d (#129): preview download relay temp dir at
// /root/.cache/preview-downloads/. Per-entry timers unlink files 5 min
// after register / GET completion; this cron is the safety net for
// orphans from crashed processes.
(async () => {
  try {
    await sweepStaleDownloads();
    cron.schedule(
      "*/5 * * * *",
      () => {
        sweepStaleDownloads().catch((err) => {
          console.warn(`[preview] download sweeper failed: ${(err as Error).message}`);
        });
      },
      { timezone: "UTC" },
    );
    console.log(`> Preview download sweeper scheduled (every 5 min, 5 min TTL)`);
  } catch (err) {
    console.warn(`!! Could not initialize download sweeper: ${(err as Error).message}`);
  }
})();

// Docker prune scheduler. Tick hourly so a freshly-deployed server starts
// pruning within the hour; `maybeRunScheduledPrune` itself checks the
// configured interval (default 7 days) before doing any work, so this is
// effectively no-op most ticks. Runs the first check at boot to sweep
// anything overdue while the container was down.
(async () => {
  try {
    await maybeRunScheduledPrune();
    cron.schedule(
      "0 * * * *",
      () => {
        maybeRunScheduledPrune().catch((err) => {
          console.warn(`[docker-prune] scheduled run failed: ${(err as Error).message}`);
        });
      },
      { timezone: "UTC" },
    );
    console.log(`> Docker prune scheduler ready (hourly check, default 7-day interval)`);
  } catch (err) {
    console.warn(`!! Could not initialize docker prune scheduler: ${(err as Error).message}`);
  }
})();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    // Preview reverse proxy — short-circuit Next.js for /chat/preview/<port>/*
    // so localhost dev servers can be iframed inside item canvases. Auth +
    // port validation live in `forwardHttp`.
    if (req.url && req.url.startsWith(`${PREVIEW_PREFIX}/`)) {
      const match = matchPreviewPath(req.url);
      if (match) {
        forwardHttp(req, res, match, { selfPort: port });
        return;
      }
    }
    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  // Global in-app notification channel. Every authenticated client that
  // connects to /ws/notifications is added here and receives a JSON frame
  // for every dispatched push event so the frontend can show in-app toasts
  // regardless of which chat the user has open or whether the OS delivers
  // the system notification.
  const notificationClients = new Set<WebSocket>();

  onNotificationDispatched((payload) => {
    if (notificationClients.size === 0) return;
    const frame = JSON.stringify({ type: "notification", payload });
    for (const ws of notificationClients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(frame);
        } catch {
          /* ignore */
        }
      } else {
        notificationClients.delete(ws);
      }
    }
  });

  // Let Next.js handle its own upgrade requests (HMR etc.)
  const nextUpgradeHandler = app.getUpgradeHandler();

  server.on("upgrade", async (req: IncomingMessage, socket, head) => {
    const { pathname, query: qs } = parse(req.url || "/", true);

    // Preview proxy WS upgrade — dev-server HMR clients connect through
    // here. Auth + port validation live in `forwardWs`. Handled before
    // the chat-route branches so they don't have to know about it.
    if (req.url && req.url.startsWith(`${PREVIEW_PREFIX}/`)) {
      const match = matchPreviewPath(req.url);
      if (match) {
        forwardWs(req, socket, head, match, { selfPort: port, wss });
        return;
      }
    }

    const isChatWs = pathname === "/ws/chat" || pathname === "/chat/ws/chat";
    const isTerminalWs = pathname === "/ws/terminal" || pathname === "/chat/ws/terminal";
    const isMonitoringWs = pathname === "/ws/monitoring" || pathname === "/chat/ws/monitoring";
    const isNotificationsWs =
      pathname === "/ws/notifications" || pathname === "/chat/ws/notifications";
    // /ws/preview-stream/<projectSlug>/<itemSlug>/<port> — opens a Chromium
    // tab against localhost:<port> in the container and screencasts it back
    // to the user's browser as JPEG frames over this WS.
    const previewStreamMatch = pathname?.match(
      /^(?:\/chat)?\/ws\/preview-stream\/([a-z0-9][a-z0-9-]{0,63})\/([a-z0-9][a-z0-9-]{0,63})\/(\d+)$/,
    );
    const isPreviewStreamWs = !!previewStreamMatch;
    // Phase 4 (#130): /ws/preview-rtc/<projectSlug>/<itemSlug>/<port>
    // pairs the user's browser (?role=viewer) with the headless
    // Chromium controller page (?role=controller) and relays SDP/ICE.
    // Same path shape as preview-stream so the auth/origin/self-loop
    // checks below stay branchless.
    const previewRtcMatch = pathname?.match(
      /^(?:\/chat)?\/ws\/preview-rtc\/([a-z0-9][a-z0-9-]{0,63})\/([a-z0-9][a-z0-9-]{0,63})\/(\d+)$/,
    );
    const isPreviewRtcWs = !!previewRtcMatch;

    if (
      !isChatWs &&
      !isTerminalWs &&
      !isMonitoringWs &&
      !isNotificationsWs &&
      !isPreviewStreamWs &&
      !isPreviewRtcWs
    ) {
      // Pass to Next.js for HMR and other internal WebSockets
      nextUpgradeHandler(req, socket, head);
      return;
    }

    // Terminal kill-switch for locked-down production deployments.
    if (isTerminalWs && process.env.DISABLE_TERMINAL === "1") {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    // Origin validation — prevent cross-site WebSocket hijacking
    const origin = req.headers.origin;
    if (!isOriginAllowed(origin)) {
      console.warn(`[ws] Rejected connection from disallowed origin: ${origin}`);
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    // Authenticate: try signed session cookie first (fast, local HMAC check),
    // then fall back to a short-lived WS ticket (?ticket=<uuid>) issued by
    // POST /api/auth/ws-ticket. Bearer tokens in URLs are intentionally NOT
    // supported here — they appear in server logs and browser history.
    const wsRoute = isTerminalWs
      ? "/ws/terminal"
      : isMonitoringWs
        ? "/ws/monitoring"
        : isNotificationsWs
          ? "/ws/notifications"
          : isPreviewStreamWs
            ? "/ws/preview-stream"
            : isPreviewRtcWs
              ? "/ws/preview-rtc"
              : "/ws/chat";
    const sessionPayload = extractSessionFromCookieHeader(req.headers.cookie);
    let actorEmail: string;
    if (sessionPayload) {
      actorEmail = sessionPayload.email;
    } else {
      const queryTicket = qs.ticket as string | undefined;
      if (!queryTicket) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        logWsUpgrade({
          route: wsRoute,
          statusCode: 401,
          actor: "anonymous",
          errorMessage: "Missing credentials",
        }).catch(() => {});
        return;
      }
      const ticketEmail = consumeWsTicket(queryTicket);
      if (!ticketEmail) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        logWsUpgrade({
          route: wsRoute,
          statusCode: 401,
          actor: "anonymous",
          errorMessage: "Invalid or expired WS ticket",
        }).catch(() => {});
        return;
      }
      actorEmail = ticketEmail;
    }

    if (isTerminalWs) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleTerminalConnection(ws, actorEmail);
      });
      logWsUpgrade({ route: wsRoute, statusCode: 101, actor: actorEmail }).catch(() => {});
      return;
    }

    if (isMonitoringWs) {
      const broadcaster = getMonitoringBroadcaster();
      wss.handleUpgrade(req, socket, head, (ws) => {
        broadcaster.register(ws);
        ws.on("message", (data) => {
          try {
            const frame = JSON.parse(data.toString()) as MonFrame;
            broadcaster.handleFrame(ws, frame);
          } catch {
            /* ignore malformed frames */
          }
        });
      });
      logWsUpgrade({ route: wsRoute, statusCode: 101, actor: actorEmail }).catch(() => {});
      return;
    }

    if (isNotificationsWs) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        notificationClients.add(ws);
        ws.on("close", () => notificationClients.delete(ws));
        ws.on("error", () => notificationClients.delete(ws));
      });
      logWsUpgrade({ route: wsRoute, statusCode: 101, actor: actorEmail }).catch(() => {});
      return;
    }

    if (isPreviewRtcWs && previewRtcMatch) {
      const projectSlug = previewRtcMatch[1];
      const itemSlug = previewRtcMatch[2];
      const previewPort = Number(previewRtcMatch[3]);
      // Same self-loop guard as the preview-stream branch above.
      if (
        !Number.isInteger(previewPort) ||
        previewPort < 1024 ||
        previewPort > 65535 ||
        previewPort === port
      ) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }
      const rawRole = qs.role;
      const roleParam = typeof rawRole === "string" ? rawRole : undefined;
      wss.handleUpgrade(req, socket, head, (ws) => {
        void handlePreviewRtc(
          ws,
          actorEmail,
          { projectSlug, itemSlug, port: previewPort },
          { selfPort: port },
          roleParam,
        );
      });
      logWsUpgrade({
        route: wsRoute,
        statusCode: 101,
        actor: actorEmail,
        target: `${projectSlug}/${itemSlug}:${previewPort}:${roleParam ?? "viewer"}`,
      }).catch(() => {});
      return;
    }

    if (isPreviewStreamWs && previewStreamMatch) {
      const projectSlug = previewStreamMatch[1];
      const itemSlug = previewStreamMatch[2];
      const previewPort = Number(previewStreamMatch[3]);
      // Same self-loop guard as the proxy: don't let the user point a
      // Chromium tab at the chat server's own port. (Chromium would
      // happily render the chat UI inside itself, which works but is
      // wasteful and confusing.)
      if (
        !Number.isInteger(previewPort) ||
        previewPort < 1024 ||
        previewPort > 65535 ||
        previewPort === port
      ) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }
      // Optional quality preset from `?quality=performance|balanced|quality`.
      // Fall through to the handler's default when missing or invalid.
      const rawQuality = qs.quality;
      const previewQuality =
        rawQuality === "performance" || rawQuality === "balanced" || rawQuality === "quality"
          ? rawQuality
          : undefined;
      // Optional wire codec from `?codec=h264|jpeg`. Client passes
      // h264 only when MediaSource.isTypeSupported(...) returned true.
      // Server falls through to JPEG (Phase 1 path) when missing or
      // invalid so cached / older clients keep working.
      const rawCodec = qs.codec;
      const previewCodec = rawCodec === "h264" || rawCodec === "jpeg" ? rawCodec : undefined;
      wss.handleUpgrade(req, socket, head, (ws) => {
        void handlePreviewStream(ws, actorEmail, {
          projectSlug,
          itemSlug,
          port: previewPort,
          quality: previewQuality,
          codec: previewCodec,
        });
      });
      logWsUpgrade({
        route: wsRoute,
        statusCode: 101,
        actor: actorEmail,
        target: `${projectSlug}/${itemSlug}:${previewPort}`,
      }).catch(() => {});
      return;
    }

    const sessionId = (qs.session as string) || "default";
    const cwdParam = (qs.cwd as string) || undefined;
    const ipHeader = (req.headers["x-forwarded-for"] as string) ?? req.socket.remoteAddress ?? "";
    const userAgent = (req.headers["user-agent"] as string)?.slice(0, 80);

    wss.handleUpgrade(req, socket, head, (ws) => {
      sessionManager.connect(ws, sessionId, cwdParam, actorEmail, {
        client: userAgent,
        ip: ipHeader.split(",")[0]?.trim(),
      });
    });
    logWsUpgrade({
      route: wsRoute,
      statusCode: 101,
      actor: actorEmail,
      target: sessionId,
    }).catch(() => {});
  });

  // Phase 4 hardening: WebRTC media flags are now always-on in
  // chromium-pool.launch(); no boot-time prelaunch call needed.
  // `--allow-running-insecure-content` was dropped — the controller
  // iframes the dev server via the same-origin /chat/preview/<port>
  // proxy, so mixed-content blocking never triggers.

  server.listen(port, () => {
    console.log(`> Claw Chat ready on http://localhost:${port}`);
    console.log(`> WebSocket endpoint: ws://localhost:${port}/ws/chat`);
    console.log(`> API_ORIGIN: ${API_ORIGIN}`);

    // Bootstrap + periodically refresh the account-level rate-limit cache
    // via a cheap /v1/messages ping. Keeps the HUD popup populated even
    // before the user has sent their first chat message this boot, and
    // after long idle periods. Noop when no OAuth token is available.
    startRateLimitProbe();

    // SDK sanity probe. If the bundled entry can't be resolved, every chat
    // query dies with a non-obvious ENOENT. Logging the resolved path + SDK
    // version on boot means the operator sees the problem immediately.
    void (async () => {
      try {
        const sdkEntry = require.resolve("@anthropic-ai/claude-agent-sdk");
        await access(sdkEntry);
        let version = "(version unknown)";
        try {
          const sdkPkg = JSON.parse(
            readFileSync(join(dirname(sdkEntry), "package.json"), "utf-8"),
          ) as { version?: string };
          if (sdkPkg.version) version = `v${sdkPkg.version}`;
        } catch {
          /* non-fatal */
        }
        console.log(`> SDK resolved: ${sdkEntry} (${version})`);
      } catch (err) {
        console.warn(
          `!! Could not resolve @anthropic-ai/claude-agent-sdk: ${(err as Error).message}. ` +
            `Chat queries will fail. Inside the container, run 'npm install' in /app.`,
        );
      }
    })();

    // Self-loop guard — if NEXT_PUBLIC_API_ORIGIN points at the chat's own
    // host or a localhost default, every /api/v1/auth/me call from the
    // session-establishment route hits us instead of the ClawOps backend
    // and login silently 401s. Warn loudly so this gets fixed instead of
    // ending up in a debugging rabbit hole.
    void (async () => {
      try {
        const url = new URL(API_ORIGIN);
        const allowed = Array.from(ALLOWED_ORIGINS);
        const chatHosts = allowed
          .map((o) => {
            try {
              return new URL(o).host;
            } catch {
              return null;
            }
          })
          .filter((h): h is string => h !== null);
        if (chatHosts.includes(url.host) || url.host.startsWith("localhost")) {
          console.warn(
            `!! NEXT_PUBLIC_API_ORIGIN (${API_ORIGIN}) looks like the chat's own host — login will 401. ` +
              `Set it to the ClawOps backend URL (e.g. https://clawops.example.com) in /opt/claw-chat/.env ` +
              `and 'docker compose up -d --force-recreate claw-chat'.`,
          );
          return;
        }
        const probe = await fetch(`${API_ORIGIN}/api/v1/auth/me`, {
          headers: { Authorization: "Bearer boot-probe" },
          signal: AbortSignal.timeout(5000),
        });
        if (probe.status !== 401 && probe.status !== 403) {
          console.warn(
            `!! API_ORIGIN probe returned ${probe.status} (expected 401/403 for invalid token). ` +
              `Check that ${API_ORIGIN} is reachable and speaks the ClawOps auth API.`,
          );
        } else {
          console.log(`> API_ORIGIN reachable (probe got ${probe.status} as expected)`);
        }
      } catch (err) {
        console.warn(
          `!! Could not reach API_ORIGIN=${API_ORIGIN}: ${(err as Error).message}. ` +
            `Login + WebSocket auth will fail until the backend is reachable.`,
        );
      }
    })();

    // Graceful shutdown: kill spawned dev servers (SIGTERM) and close
    // the headless Chromium pool so docker stop doesn't orphan them.
    // SIGINT is what Ctrl-C in `npm run dev` sends; SIGTERM is what
    // docker stop / k8s sends. Both handled identically.
    const shutdown = (signal: string) => {
      console.log(`> Shutdown (${signal}): killing dev servers + Chromium pool`);
      try {
        killAllDevServers();
      } catch {
        /* best effort */
      }
      void closeChromiumPool().catch(() => {
        /* best effort */
      });
      // Give the cleanup a moment, then let the process exit naturally.
      setTimeout(() => process.exit(0), 1000);
    };
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
  });
});
