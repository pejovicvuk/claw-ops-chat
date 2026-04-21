import "dotenv/config";
import { createServer, IncomingMessage } from "http";
import { parse } from "url";
import { readFileSync } from "fs";
import { access } from "fs/promises";
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
import { detectClaude } from "./src/lib/claude-status";
import { resolveShell } from "./src/lib/terminal-shell";
import { loadCredentialsSync as loadBitbucketCredentials } from "./src/lib/bitbucket-custom-config";
import { existsSync, readdirSync, statSync } from "fs";
import {
  setSessionStatus,
  clearSessionStatus,
  type SessionStatus,
} from "./src/lib/session-status-store";
import {
  deleteSessionFile,
  loadAllSessions,
  persistSession,
  type PersistedSession,
} from "./src/lib/session-persistence";

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

/* Load MCP servers from ~/.claude.json */
let mcpServers: Record<string, unknown> | undefined;
try {
  const claudeJson = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf-8"));
  if (claudeJson.mcpServers && Object.keys(claudeJson.mcpServers).length > 0) {
    mcpServers = claudeJson.mcpServers;
    console.log(`> Loaded MCP servers: ${Object.keys(mcpServers!).join(", ")}`);
  }
} catch {
  // No ~/.claude.json or invalid — continue without MCP
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
  currentQuery: { interrupt?: () => Promise<void> } | null;
  /** Original cwd for resume (the cwd where this session was first created). */
  sessionCwd: string | null;
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
}

/**
 * Check whether Claude Code has a persisted JSONL file for the given
 * session id. The SDK writes conversation history to
 * ~/.claude/projects/<project-hash>/<session-id>.jsonl once a session
 * has produced at least one assistant turn. Used to decide whether a
 * UUID-shaped sessionId coming in over the WebSocket represents a real
 * resumable conversation or a brand-new chat the client just invented.
 */
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
/*  WebSocket auth helper                                              */
/* ------------------------------------------------------------------ */

/**
 * Validate an access token by calling the Spring backend's /auth/me.
 * Returns true if the token is valid and the email matches ALLOWED_EMAIL.
 */
async function validateAccessToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_ORIGIN}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const user = (await res.json()) as { email: string };
    return user.email.toLowerCase() === ALLOWED_EMAIL.toLowerCase();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Session Manager                                                    */
/* ------------------------------------------------------------------ */

class SessionManager {
  private sessions = new Map<string, ChatSession>();

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
        requestCounter: 0,
        accumulatedText: "",
        messageTimestamps: [],
        eventHistory: [],
        lastActivity: Date.now(),
        abortController: null,
        currentQuery: null,
        sessionCwd: null,
        status: "idle",
        lastUserMessage: "",
        wasInterrupted: false,
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
      requestCounter: 0,
      accumulatedText: persisted.accumulatedText ?? "",
      messageTimestamps: [],
      eventHistory: Array.isArray(persisted.eventHistory) ? persisted.eventHistory : [],
      lastActivity: persisted.lastActivity || Date.now(),
      abortController: null,
      currentQuery: null,
      sessionCwd: persisted.sessionCwd ?? null,
      // Status is always reset to "idle" on boot — whatever was in
      // flight is gone. The wasInterrupted flag is what tells the
      // client something was cut short.
      status: "idle",
      lastUserMessage: persisted.lastUserMessage ?? "",
      wasInterrupted: wasMidTurn,
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
      claudeSessionId: session.claudeSessionId,
      sessionCwd: session.sessionCwd,
      eventHistory: session.eventHistory,
      sessionAllowedTools: Array.from(session.sessionAllowedTools),
      accumulatedText: session.accumulatedText,
      lastActivity: session.lastActivity,
      lastUserMessage: session.lastUserMessage,
      wasInterrupted: session.wasInterrupted,
    });
  }

  connect(ws: WebSocket, sessionId: string, sessionCwd?: string) {
    const session = this.getOrCreateSession(sessionId);
    session.clients.add(ws);

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

    // Always send the current status snapshot on reconnect. Without this,
    // a browser that reconnected after a status change (e.g. after a
    // tool finished running) would sit on whatever state it had before
    // the disconnect — often showing "thinking…" forever, or worse,
    // silently missing the fact that a permission prompt is pending.
    this.send(ws, { type: "status", status: session.status });

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

        const msg = JSON.parse(data.toString());
        this.handleMessage(session, ws, msg);
      } catch {
        console.warn(`[session=${sessionId}] Malformed WebSocket message`);
      }
    });

    ws.on("close", () => {
      clearInterval(heartbeat);
      session.clients.delete(ws);
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
      session.accumulatedText = "";
      return;
    }

    if (type === "stop") {
      if (session.isProcessing) {
        // Drain any pending approval/question/plan requests first — without
        // this, the SDK stays blocked inside canUseTool waiting for a
        // response that will never come and .interrupt() can't take
        // effect. Deny-resolve each one with an interrupt marker.
        for (const [id, resolve] of session.pendingRequests) {
          resolve({
            allow: false,
            approve: false,
            answers: {},
            message: "Interrupted by user",
          });
          this.broadcast(session, { type: "permission_resolved", id });
        }
        session.pendingRequests.clear();

        // Prefer the SDK's graceful interrupt — it emits a proper `result`
        // message with an interrupt subtype so the for-await loop tears
        // down cleanly. Fall back to AbortController for older SDK builds
        // that don't expose .interrupt().
        const q = session.currentQuery;
        if (q?.interrupt) {
          q.interrupt().catch(() => {
            session.abortController?.abort();
          });
        } else {
          session.abortController?.abort();
        }

        this.broadcast(session, { type: "result", text: "Stopped by user", isError: false });
        this.setStatus(session, "idle");
      }
      return;
    }

    if (type === "set_effort") {
      session.effort = (msg.effort as string) || null;
      return;
    }

    if (type === "set_mode") {
      session.permissionMode = (msg.mode as string) || "default";
      return;
    }
  }

  private async handleUserMessage(session: ChatSession, text: string) {
    session.isProcessing = true;
    session.accumulatedText = "";
    const abortController = new AbortController();
    session.abortController = abortController;
    // Kick off the status machine for this turn — sidebar dot flips blue
    // the moment the query starts, not only once the first token streams.
    this.setStatus(session, "thinking");
    // Lifecycle anchor for the UI timeline — the client uses this to open
    // a new assistant-turn container before any stream_event arrives.
    const turnId = `turn-${Date.now()}-${++session.requestCounter}`;
    this.broadcast(session, { type: "turn_start", turnId });
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
      ...(process.env.CLAUDE_THINKING !== "off" ? { thinking: { type: "adaptive" } } : {}),
      canUseTool: async (toolName: string, input: Record<string, unknown>) => {
        // Handle AskUserQuestion
        if (toolName === "AskUserQuestion") {
          const id = `req-${++session.requestCounter}`;
          this.broadcast(session, { type: "ask_question", id, questions: input.questions || [] });
          this.setStatus(session, "awaiting_input");
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
          const id = `req-${++session.requestCounter}`;
          const planText = typeof input.plan === "string" ? input.plan : JSON.stringify(input);
          this.broadcast(session, { type: "plan_proposal", id, plan: planText });
          this.setStatus(session, "awaiting_permission");
          const response = await this.waitForResponse(session, id);
          this.setStatus(session, "thinking");

          const approve = response.approve === true;
          const newMode = typeof response.newMode === "string" ? response.newMode : null;
          if (approve) {
            // Default behaviour after plan approval is to flip into
            // acceptEdits so Claude can actually execute the plan it
            // just proposed; the client can override by sending
            // newMode: "default" if the user wants to keep confirming.
            if (newMode === "default" || newMode === "plan" || newMode === "acceptEdits") {
              session.permissionMode = newMode;
            } else {
              session.permissionMode = "acceptEdits";
            }
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

        if (mode === "acceptEdits") {
          // Auto-allow safe tools + edit tools, ask for Bash and others
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
        const id = `req-${++session.requestCounter}`;
        const description = getToolDescription(toolName, input);
        this.broadcast(session, { type: "permission_request", id, toolName, input, description });
        this.setStatus(session, "awaiting_permission");
        const response = await this.waitForResponse(session, id);
        this.setStatus(session, "tool_running");

        if (response.allow) {
          if (response.allowSession) {
            session.sessionAllowedTools.add(toolName);
          }
          return { behavior: "allow", updatedInput: input };
        }
        return { behavior: "deny", message: response.message || "User denied this action" };
      },
      ...(session.effort ? { effort: session.effort } : {}),
      ...(mcpServers ? { mcpServers } : {}),
      // Tell Claude which permission mode it's in via systemPrompt. Without
      // this, the server's canUseTool silently denies Bash/Edit in plan
      // mode but Claude doesn't *know* it's in plan mode, so it can go
      // "I'll run this command…" → denial → retry → loop. Giving it an
      // explicit instruction avoids the loop and nudges it toward
      // ExitPlanMode when it's ready.
      ...(session.permissionMode === "plan"
        ? {
            systemPrompt: {
              type: "preset",
              preset: "claude_code",
              append:
                "\n\nYou are currently in PLAN MODE. Do not run shell commands, " +
                "edit files, or write new files in this turn — the host will " +
                "deny those tool calls. Instead, propose a plan and call " +
                "ExitPlanMode when you are ready for the user to review it.",
            },
          }
        : session.permissionMode === "acceptEdits"
          ? {
              systemPrompt: {
                type: "preset",
                preset: "claude_code",
                append:
                  "\n\nYou are in ACCEPT-EDITS MODE. File edits and writes are " +
                  "pre-approved; proceed without asking for permission for those " +
                  "tools. Shell commands still require explicit approval.",
              },
            }
          : {}),
      // If the user saved Bitbucket creds in Settings, inject the three env
      // vars the read-only bitbucket skill at /opt/skills/bitbucket/ reads.
      // Loaded fresh from disk per-query so rotated tokens take effect
      // without restarting the container.
      env: (() => {
        const bb = loadBitbucketCredentials();
        if (!bb) return undefined;
        return {
          ATLASSIAN_EMAIL: bb.email,
          BITBUCKET_API_TOKEN: bb.apiToken,
          BITBUCKET_WORKSPACE: bb.workspace,
        };
      })(),
      abortController,
      spawnClaudeCodeProcess: spawnClaude,
    };

    const queryParams: Record<string, unknown> = { prompt: text, options: queryOptions };
    const resumeId = session.claudeSessionId;
    if (resumeId) {
      (queryParams.options as Record<string, unknown>).resume = resumeId;
    }

    try {
      let messageStream;
      try {
        messageStream = query(queryParams as Parameters<typeof query>[0]);
        // Stash the Query handle so the `stop` client message can call
        // .interrupt() on it for a graceful SDK-level stop.
        session.currentQuery = messageStream as unknown as {
          interrupt?: () => Promise<void>;
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
          };
        } else {
          throw resumeErr;
        }
      }

      for await (const message of messageStream!) {
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
              this.broadcast(session, {
                type: "tool_use_start",
                id: pendingToolUse.id,
                name: pendingToolUse.name,
                input: parsedInput,
              });
              pendingToolUse = null;
              toolInputAccum = "";
            }
            continue;
          }

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
          if (usage) {
            this.broadcastAssistantUsage(session, usage);
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
              }
            }
          }
          continue;
        }

        // Result — turn complete
        if (msg.type === "result") {
          // If resume failed, retry without resume
          if (
            msg.is_error &&
            typeof msg.result === "string" &&
            msg.result.includes("No conversation found")
          ) {
            session.claudeSessionId = null;
            // Retry the query without resume
            delete (queryParams.options as Record<string, unknown>).resume;
            session.isProcessing = false;
            session.currentQuery = null;
            this.handleUserMessage(session, text);
            return;
          }
          session.claudeSessionId = msg.session_id as string;
          session.accumulatedText = "";
          this.broadcast(session, {
            type: "result",
            text: msg.result || "",
            sessionId: msg.session_id,
            isError: msg.is_error || false,
            subtype: msg.subtype,
            permissionDenials: msg.permission_denials || [],
          });
          this.broadcast(session, {
            type: "turn_end",
            turnId,
            isError: msg.is_error || false,
            subtype: msg.subtype,
          });
          this.broadcastContextUsage(session, msg.modelUsage);
          // Clear event history after turn completes — JSONL has the persisted record
          session.eventHistory = [];
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
    } catch (err) {
      const rawMessage0 = err instanceof Error ? err.message : "Unknown error";
      // Resume-not-found surfaces here when the SDK throws DURING the
      // for-await loop (rather than yielding a result message with
      // is_error=true). Recover by wiping claudeSessionId and rerunning
      // handleUserMessage — the user sees one spinner cycle, not a
      // cryptic "No conversation found" error bubble.
      if (
        rawMessage0.toLowerCase().includes("no conversation found") ||
        /returned an error result/i.test(rawMessage0)
      ) {
        session.claudeSessionId = null;
        delete (queryParams.options as Record<string, unknown>).resume;
        session.isProcessing = false;
        session.abortController = null;
        session.currentQuery = null;
        this.setStatus(session, "idle");
        this.handleUserMessage(session, text);
        return;
      }

      session.accumulatedText = "";
      const rawMessage = rawMessage0;
      const errnoErr = err as NodeJS.ErrnoException;
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
      const lowered = rawMessage.toLowerCase();
      const setupRequired =
        errnoErr.code === "ENOENT" ||
        errnoErr.code === "EACCES" ||
        lowered.includes("executable not found") ||
        lowered.includes("native binary not found") ||
        lowered.includes("no such file");

      // Detect Anthropic / Claude-Code auth failures specifically. The
      // SDK surfaces these as a plain Error whose message contains the
      // JSON body from api.anthropic.com — something like:
      //   API Error: 401 {"type":"error","error":{
      //       "type":"authentication_error",
      //       "message":"Invalid authentication credentials"}}
      // When we see that shape, emit a dedicated auth-required event so
      // the UI can pop the "sign in to Claude" flow instead of showing
      // the raw 401 blob as a generic error bubble.
      const authError =
        lowered.includes("authentication_error") ||
        lowered.includes("invalid authentication credentials") ||
        /\b401\b/.test(rawMessage) ||
        lowered.includes("unauthorized");

      const stderrTail =
        typeof (errnoErr as unknown as { stderr?: string }).stderr === "string"
          ? (errnoErr as unknown as { stderr: string }).stderr
              .trim()
              .split(/\r?\n/)
              .slice(-10)
              .join("\n")
          : undefined;

      if (authError) {
        this.broadcast(session, {
          type: "auth_required",
          provider: "claude",
          message:
            "Claude rejected the stored credentials (HTTP 401). Your OAuth " +
            "token has probably expired — sign in again to keep chatting.",
          hint: "Run `claude auth login` in the container terminal, or click below.",
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
    }

    session.isProcessing = false;
    session.abortController = null;
    session.currentQuery = null;
    // Turn is done — flip the dot off. If a queued message starts next,
    // handleUserMessage() will flip it straight back to "thinking".
    this.setStatus(session, "idle");

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

  private broadcast(session: ChatSession, event: Record<string, unknown>) {
    session.lastActivity = Date.now();

    // Save to history for reconnecting clients (skip transient status events)
    if (event.type !== "status") {
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

    const data = JSON.stringify(event);
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  private send(ws: WebSocket, event: Record<string, unknown>) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  /** Broadcast context usage from the final `result.modelUsage` (authoritative). */
  private broadcastContextUsage(session: ChatSession, modelUsage: unknown): void {
    if (!modelUsage || typeof modelUsage !== "object") return;
    const firstModel = Object.values(modelUsage as Record<string, unknown>)[0] as
      | {
          inputTokens?: number;
          cacheReadInputTokens?: number;
          cacheCreationInputTokens?: number;
          contextWindow?: number;
        }
      | undefined;
    if (!firstModel || !firstModel.contextWindow) return;

    const used =
      (firstModel.inputTokens || 0) +
      (firstModel.cacheReadInputTokens || 0) +
      (firstModel.cacheCreationInputTokens || 0);
    const max = firstModel.contextWindow;

    this.broadcast(session, {
      type: "context_usage",
      used,
      max,
      percentage: Math.round((used / max) * 100),
    });
  }

  /** Broadcast live context usage from an assistant message's `usage` field. */
  private broadcastAssistantUsage(session: ChatSession, usage: Record<string, number>): void {
    // The assistant message has raw API usage (input_tokens snake_case).
    const used =
      (usage.input_tokens || 0) +
      (usage.cache_read_input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0);
    // Context window isn't in assistant usage — assume 1M.
    // The final `result` event corrects this with the real contextWindow from modelUsage.
    const max = 1_000_000;
    if (used === 0) return;

    this.broadcast(session, {
      type: "context_usage",
      used,
      max,
      percentage: Math.round((used / max) * 100),
    });
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

  // Default: allow same-host origins (any port)
  try {
    const url = new URL(origin);
    return (
      url.hostname === "localhost" || url.hostname === "127.0.0.1" || origin.includes(".viksi.ai")
    );
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Start                                                              */
/* ------------------------------------------------------------------ */

const app = next({ dev });
const handle = app.getRequestHandler();
const sessionManager = new SessionManager();

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

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  // Let Next.js handle its own upgrade requests (HMR etc.)
  const nextUpgradeHandler = app.getUpgradeHandler();

  server.on("upgrade", async (req: IncomingMessage, socket, head) => {
    const { pathname, query: qs } = parse(req.url || "/", true);

    const isChatWs = pathname === "/ws/chat" || pathname === "/chat/ws/chat";
    const isTerminalWs = pathname === "/ws/terminal" || pathname === "/chat/ws/terminal";

    if (!isChatWs && !isTerminalWs) {
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
    // then fall back to validating access token via the Spring backend.
    const sessionPayload = extractSessionFromCookieHeader(req.headers.cookie);
    if (!sessionPayload) {
      const queryToken = qs.token as string | undefined;
      if (!queryToken) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const valid = await validateAccessToken(queryToken);
      if (!valid) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    if (isTerminalWs) {
      const email = sessionPayload?.email ?? "anonymous";
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleTerminalConnection(ws, email);
      });
      return;
    }

    const sessionId = (qs.session as string) || "default";
    const cwdParam = (qs.cwd as string) || undefined;

    wss.handleUpgrade(req, socket, head, (ws) => {
      sessionManager.connect(ws, sessionId, cwdParam);
    });
  });

  server.listen(port, () => {
    console.log(`> Claw Chat ready on http://localhost:${port}`);
    console.log(`> WebSocket endpoint: ws://localhost:${port}/ws/chat`);
    console.log(`> API_ORIGIN: ${API_ORIGIN}`);

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
  });
});
