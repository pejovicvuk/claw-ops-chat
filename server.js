"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const http_1 = require("http");
const url_1 = require("url");
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const child_process_1 = require("child_process");
const path_1 = require("path");
const os_1 = require("os");
const next_1 = __importDefault(require("next"));
const ws_1 = require("ws");
/* SDK loaded via sdk-loader.js (plain CJS) to prevent tsx/esbuild from
   transforming the require and breaking the SDK's import.meta.url resolution. */
const sdk_loader_js_1 = __importDefault(require("./sdk-loader.js"));
const { query } = sdk_loader_js_1.default;
const auth_server_1 = require("./src/lib/auth-server");
const claude_status_1 = require("./src/lib/claude-status");
const terminal_shell_1 = require("./src/lib/terminal-shell");
const jira_custom_config_1 = require("./src/lib/jira-custom-config");
const trello_custom_config_1 = require("./src/lib/trello-custom-config");
const platform_detect_1 = require("./src/lib/platform-detect");
const fs_2 = require("fs");
const session_status_store_1 = require("./src/lib/session-status-store");
const session_persistence_1 = require("./src/lib/session-persistence");
const agent_config_1 = require("./src/lib/agent-config");
const tool_policy_1 = require("./src/lib/reports/tool-policy");
const scheduler_1 = require("./src/lib/reports/scheduler");
const scheduler_singleton_1 = require("./src/lib/reports/scheduler-singleton");
const session_manager_singleton_1 = require("./src/lib/reports/session-manager-singleton");
let ptyModule = null;
let ptyLoadError = null;
function loadPty() {
    if (ptyModule)
        return ptyModule;
    if (ptyLoadError)
        throw ptyLoadError;
    try {
        ptyModule = require("node-pty");
        return ptyModule;
    }
    catch (err) {
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
function spawnClaude(opts) {
    const cmd = opts.command.split(path_1.sep).join("/");
    const args = opts.args.map((a) => a.split(path_1.sep).join("/"));
    return (0, child_process_1.spawn)(cmd, args, {
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
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:8080").replace(/\/+$/, "");
/** Allowed origins for WebSocket connections. Auto-populated from ALLOWED_ORIGINS env or defaults. */
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean));
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
function loadMcpServers() {
    try {
        const claudeJson = JSON.parse((0, fs_1.readFileSync)((0, path_1.join)((0, os_1.homedir)(), ".claude.json"), "utf-8"));
        if (claudeJson.mcpServers && Object.keys(claudeJson.mcpServers).length > 0) {
            return claudeJson.mcpServers;
        }
    }
    catch {
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
}
catch {
    /* ignore */
}
/** Heartbeat interval in ms (default: 30 seconds). */
const HEARTBEAT_INTERVAL_MS = 30000;
/** Maximum WebSocket messages per second per session (default: 20). */
const WS_RATE_LIMIT = parseInt(process.env.WS_RATE_LIMIT || "20", 10);
const claudeInfo = (0, claude_status_1.detectClaude)();
if (claudeInfo.available) {
    console.log(`> Claude Code: ${claudeInfo.version} at ${claudeInfo.path}`);
}
else {
    console.warn(`> Claude Code: not available — ${claudeInfo.error}`);
}
if (!ALLOWED_EMAIL) {
    console.error("FATAL: ALLOWED_EMAIL environment variable is required");
    process.exit(1);
}
/**
 * Check whether Claude Code has a persisted JSONL file for the given
 * session id. The SDK writes conversation history to
 * ~/.claude/projects/<project-hash>/<session-id>.jsonl once a session
 * has produced at least one assistant turn. Used to decide whether a
 * UUID-shaped sessionId coming in over the WebSocket represents a real
 * resumable conversation or a brand-new chat the client just invented.
 */
function claudeSessionFileExists(sessionId) {
    const projectsDir = (0, path_1.join)((0, os_1.homedir)(), ".claude", "projects");
    if (!(0, fs_2.existsSync)(projectsDir))
        return false;
    const target = `${sessionId}.jsonl`;
    try {
        for (const proj of (0, fs_2.readdirSync)(projectsDir)) {
            const projPath = (0, path_1.join)(projectsDir, proj);
            const s = (0, fs_2.statSync)(projPath, { throwIfNoEntry: false });
            if (!s || !s.isDirectory())
                continue;
            if ((0, fs_2.existsSync)((0, path_1.join)(projPath, target)))
                return true;
        }
    }
    catch {
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
async function validateAccessToken(token) {
    try {
        const res = await fetch(`${API_ORIGIN}/api/v1/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok)
            return false;
        const user = (await res.json());
        return user.email.toLowerCase() === ALLOWED_EMAIL.toLowerCase();
    }
    catch {
        return false;
    }
}
/* ------------------------------------------------------------------ */
/*  Session Manager                                                    */
/* ------------------------------------------------------------------ */
class SessionManager {
    constructor() {
        this.sessions = new Map();
        /**
         * Coalesced disk persist — each call schedules a write on a microtask
         * so a flurry of broadcasts (e.g. streaming text tokens) produces one
         * file write instead of hundreds. Safe to fire on every event.
         */
        this.pendingPersists = new Set();
    }
    getOrCreateSession(sessionId) {
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
                userAborted: false,
                sessionCwd: null,
                status: "idle",
                lastUserMessage: "",
                wasInterrupted: false,
                cronPolicy: null,
                cronOnComplete: null,
                cronOnEvent: null,
                cronAbortTimer: null,
                cronTokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
            };
            this.sessions.set(sessionId, session);
            (0, session_status_store_1.setSessionStatus)(sessionId, "idle");
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
    aliasClaudeSessionId(session) {
        const sid = session.claudeSessionId;
        if (!sid || sid === session.id)
            return;
        const existing = this.sessions.get(sid);
        if (existing === session)
            return;
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
        (0, session_status_store_1.setSessionStatus)(sid, session.status);
    }
    /**
     * Reconstruct a session from disk. Called once at boot for every
     * persisted session file. Runtime-only fields (clients, pending
     * requests, rate-limit timestamps, abort controller, message queue)
     * reset to empty; replayable state (eventHistory, claudeSessionId,
     * permissionMode, allowed-tools set) survives.
     */
    restoreFromDisk(persisted) {
        const midTurnStatus = [
            "thinking",
            "tool_running",
            "awaiting_permission",
            "awaiting_input",
        ];
        const wasMidTurn = midTurnStatus.includes(persisted.status);
        const session = {
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
            userAborted: false,
            sessionCwd: persisted.sessionCwd ?? null,
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
        };
        this.sessions.set(session.id, session);
        (0, session_status_store_1.setSessionStatus)(session.id, "idle");
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
    setStatus(session, status) {
        session.status = status;
        (0, session_status_store_1.setSessionStatus)(session.id, status);
        if (session.claudeSessionId && session.claudeSessionId !== session.id) {
            (0, session_status_store_1.setSessionStatus)(session.claudeSessionId, status);
        }
        this.broadcast(session, { type: "status", status });
        // Fire-and-forget disk persist so a crash between now and the next
        // setStatus call doesn't forget this transition. Errors are logged
        // but never thrown — persistence is belt-and-suspenders, not a
        // correctness primitive.
        this.queuePersist(session);
    }
    queuePersist(session) {
        if (this.pendingPersists.has(session.id))
            return;
        this.pendingPersists.add(session.id);
        queueMicrotask(() => {
            this.pendingPersists.delete(session.id);
            this.persistNow(session).catch((err) => {
                console.warn(`[session=${session.id}] persist failed:`, err.message);
            });
        });
    }
    async persistNow(session) {
        await (0, session_persistence_1.persistSession)({
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
    connect(ws, sessionId, sessionCwd) {
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
            }
            catch {
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
            }
            catch {
                console.warn(`[session=${sessionId}] Malformed WebSocket message`);
            }
        });
        ws.on("close", () => {
            clearInterval(heartbeat);
            session.clients.delete(ws);
            // Sessions stay alive even with 0 clients — work continues in background.
            // Only cleanup idle sessions (not processing, no clients) after 30 minutes.
            if (session.clients.size === 0 && !session.isProcessing) {
                setTimeout(() => {
                    if (session.clients.size === 0 && !session.isProcessing) {
                        // Check if truly idle for a while
                        if (Date.now() - session.lastActivity > 30 * 60 * 1000) {
                            this.sessions.delete(session.id);
                            (0, session_status_store_1.clearSessionStatus)(session.id);
                            // Also drop any alias pointing at this session so the
                            // next WS under the SDK id creates a fresh empty one
                            // rather than resurrecting a partially-torn-down object.
                            if (session.claudeSessionId && session.claudeSessionId !== session.id) {
                                const aliased = this.sessions.get(session.claudeSessionId);
                                if (aliased === session) {
                                    this.sessions.delete(session.claudeSessionId);
                                    (0, session_status_store_1.clearSessionStatus)(session.claudeSessionId);
                                }
                            }
                        }
                    }
                }, 30 * 60 * 1000);
            }
        });
    }
    /** Sliding-window rate limiter. Returns false if the message should be rejected. */
    checkRateLimit(session) {
        const now = Date.now();
        // Remove timestamps older than 1 second
        session.messageTimestamps = session.messageTimestamps.filter((t) => now - t < 1000);
        if (session.messageTimestamps.length >= WS_RATE_LIMIT) {
            return false;
        }
        session.messageTimestamps.push(now);
        return true;
    }
    handleMessage(session, _ws, msg) {
        const type = msg.type;
        if (type === "message") {
            const text = msg.text;
            // Remember the last user-sent text for post-restart Resume UX.
            session.lastUserMessage = text;
            this.queuePersist(session);
            if (session.isProcessing) {
                session.messageQueue.push({ text });
            }
            else {
                this.handleUserMessage(session, text);
            }
            return;
        }
        if (type === "permission_response" || type === "ask_response" || type === "plan_response") {
            const id = msg.id;
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
            }
            return;
        }
        if (type === "set_effort") {
            session.effort = msg.effort || null;
            return;
        }
        if (type === "set_mode") {
            session.permissionMode = msg.mode || "default";
            return;
        }
    }
    async handleUserMessage(session, text) {
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
        let pendingToolUse = null;
        const getToolDescription = (toolName, input) => {
            if (toolName === "Bash" && input.command)
                return input.command.slice(0, 120);
            if (["Read", "Write", "Edit"].includes(toolName) && input.file_path)
                return input.file_path;
            if (toolName === "Grep" && input.pattern)
                return `pattern: ${input.pattern}`;
            if (toolName === "Glob" && input.pattern)
                return `pattern: ${input.pattern}`;
            return "";
        };
        // Fresh read per-turn so "Agent behavior" settings edits (system prompt
        // + rules) apply on the very next message — matching the loadMcpServers
        // pattern below. Always returns a string; never throws.
        const customAppend = await (0, agent_config_1.getCustomAppendForSdk)();
        const modeAppend = session.permissionMode === "plan"
            ? "You are currently in PLAN MODE. Do not run shell commands, " +
                "edit files, or write new files in this turn — the host will " +
                "deny those tool calls. Instead, propose a plan and call " +
                "ExitPlanMode when you are ready for the user to review it."
            : session.permissionMode === "acceptEdits"
                ? "You are in ACCEPT-EDITS MODE. File edits and writes are " +
                    "pre-approved; proceed without asking for permission for those " +
                    "tools. Shell commands still require explicit approval."
                : "";
        const combinedAppend = [customAppend, modeAppend].filter(Boolean).join("\n\n");
        const queryOptions = {
            // Prefer the original cwd from JSONL (for resume to find the session file).
            // Fall back to CLAUDE_CWD env, then homedir() (works cross-platform).
            // `/root` (Docker default) doesn't exist on Windows/Mac and causes spawn ENOENT.
            cwd: session.sessionCwd || process.env.CLAUDE_CWD || (0, os_1.homedir)(),
            includePartialMessages: true,
            // Adaptive thinking lets Claude allocate reasoning tokens when the
            // problem warrants it. Delivered as thinking_delta stream events,
            // which the UI renders as a collapsible Thinking block. Opt-out
            // with CLAUDE_THINKING=off if the extra tokens cost matter.
            ...(process.env.CLAUDE_THINKING !== "off" ? { thinking: { type: "adaptive" } } : {}),
            // Pass the mode through to the SDK. Without this, the SDK never
            // exposes the ExitPlanMode tool to Claude when the user chose
            // plan mode — Claude couldn't call it even when asked, and just
            // wrote a prose "plan" into the chat. Also enables SDK-level
            // gating for acceptEdits / bypassPermissions.
            ...(session.permissionMode === "plan"
                ? { permissionMode: "plan" }
                : session.permissionMode === "acceptEdits"
                    ? { permissionMode: "acceptEdits" }
                    : session.permissionMode === "bypassPermissions"
                        ? {
                            permissionMode: "bypassPermissions",
                            allowDangerouslySkipPermissions: true,
                        }
                        : {}),
            canUseTool: async (toolName, input) => {
                // Autonomous cron runs take a short-circuit path: decideCronTool
                // enforces the per-job allowlist, bash-prefix filter, and turn
                // budget — with no interactive prompts at all. Returning here
                // keeps the interactive branches below 100% untouched so the
                // existing chat behavior is byte-identical after this refactor.
                if (session.cronPolicy) {
                    const decision = (0, tool_policy_1.decideCronTool)(session.cronPolicy, toolName, input);
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
                        }
                        else {
                            session.permissionMode = "acceptEdits";
                        }
                        return { behavior: "allow", updatedInput: input };
                    }
                    return {
                        behavior: "deny",
                        message: typeof response.message === "string" && response.message.trim()
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
                }
                else if (mode === "plan") {
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
            ...(() => {
                // Fresh read per-turn so MCP servers the user just wired up in
                // Settings (Google, Bitbucket, Notion, etc.) land on their very
                // next message instead of after a container restart.
                const current = loadMcpServers();
                return current ? { mcpServers: current } : {};
            })(),
            // System prompt append. Combines the user's "Agent behavior" settings
            // (custom prompt + concatenated rules from $CLAUDE_CWD/.claude/) with
            // the mode-specific hint that tells Claude whether it's in plan or
            // accept-edits mode. Without the mode hint, canUseTool silently
            // denies Bash/Edit in plan mode but Claude doesn't *know* it's in
            // plan mode, so it can loop "I'll run this command…" → denial → retry.
            ...(combinedAppend
                ? {
                    systemPrompt: {
                        type: "preset",
                        preset: "claude_code",
                        append: `\n\n${combinedAppend}`,
                    },
                }
                : {}),
            // Load CLAUDE.md + .claude/agents/ + .claude/skills/ from the session's
            // working directory so subagents and skills configured via Settings →
            // Agent apply natively (rules are baked into the append above).
            settingSources: ["project"],
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
                const base = (0, platform_detect_1.augmentPathWithLocalBin)();
                const out = { ...base };
                // Bitbucket creds no longer live here — they ride along with the
                // `bitbucket` MCP server's own env block in ~/.claude.json (see
                // src/lib/bitbucket-custom-config.ts#registerMcpServer).
                const jira = (0, jira_custom_config_1.loadCredentialsSync)();
                const trello = (0, trello_custom_config_1.loadCredentialsSync)();
                if (jira) {
                    out.JIRA_URL = `https://${jira.domain}`;
                    out.JIRA_EMAIL = jira.email;
                    out.JIRA_API_TOKEN = jira.apiToken;
                    out.ATLASSIAN_EMAIL = jira.email;
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
        const queryParams = { prompt: text, options: queryOptions };
        const resumeId = session.claudeSessionId;
        if (resumeId) {
            queryParams.options.resume = resumeId;
        }
        try {
            let messageStream;
            try {
                messageStream = query(queryParams);
                // Stash the Query handle so the `stop` client message can call
                // .interrupt() on it for a graceful SDK-level stop.
                session.currentQuery = messageStream;
                // Try to get the first message to detect resume failures early
                const first = await messageStream.next();
                if (!first.done) {
                    // Process the first message
                    const msg = first.value;
                    if (msg.type === "system" && msg.subtype === "init") {
                        session.claudeSessionId = msg.session_id;
                        // Mirror the current status into the newly-known SDK session
                        // id so the sidebar — which keys off the SDK id from
                        // /api/sessions — picks up the dot immediately instead of
                        // waiting for the next setStatus.
                        if (session.claudeSessionId !== session.id) {
                            (0, session_status_store_1.setSessionStatus)(session.claudeSessionId, session.status);
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
            }
            catch (resumeErr) {
                // Resume failed — retry without resume
                const errMsg = resumeErr instanceof Error ? resumeErr.message : "";
                if (errMsg.includes("No conversation found") || errMsg.includes("session")) {
                    delete queryParams.options.resume;
                    session.claudeSessionId = null;
                    messageStream = query(queryParams);
                    session.currentQuery = messageStream;
                }
                else {
                    throw resumeErr;
                }
            }
            for await (const message of messageStream) {
                const msg = message;
                // Session init
                if (msg.type === "system" && msg.subtype === "init") {
                    session.claudeSessionId = msg.session_id;
                    if (session.claudeSessionId !== session.id) {
                        (0, session_status_store_1.setSessionStatus)(session.claudeSessionId, session.status);
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
                        trigger: msg.compact_metadata,
                    });
                    continue;
                }
                // Stream events
                if (msg.type === "stream_event") {
                    const event = msg.event;
                    if (!event)
                        continue;
                    const eventType = event.type;
                    const delta = event.delta;
                    if (eventType === "content_block_delta" && delta?.type === "text_delta") {
                        session.accumulatedText += delta.text;
                        this.broadcast(session, { type: "text_delta", text: delta.text });
                        continue;
                    }
                    if (eventType === "content_block_delta" && delta?.type === "thinking_delta") {
                        this.broadcast(session, { type: "thinking_delta", text: delta.thinking });
                        continue;
                    }
                    if (eventType === "content_block_start") {
                        const block = event.content_block;
                        if (block?.type === "tool_use") {
                            toolInputAccum = "";
                            pendingToolUse = { id: block.id, name: block.name };
                        }
                        continue;
                    }
                    if (eventType === "content_block_delta" && delta?.type === "input_json_delta") {
                        toolInputAccum += delta.partial_json;
                        continue;
                    }
                    if (eventType === "content_block_stop") {
                        if (pendingToolUse) {
                            let parsedInput = {};
                            try {
                                parsedInput = JSON.parse(toolInputAccum);
                            }
                            catch {
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
                    const userMsg = msg.message;
                    const content = userMsg?.content;
                    if (Array.isArray(content)) {
                        for (const item of content) {
                            if (item.type === "tool_result") {
                                const resultContent = typeof item.content === "string"
                                    ? item.content
                                    : Array.isArray(item.content)
                                        ? item.content.map((c) => c.text || "").join("")
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
                    const assistantMsg = msg.message;
                    // Broadcast live context usage from assistant usage field.
                    // The assistant.message.usage has input_tokens, cache_read_input_tokens, cache_creation_input_tokens.
                    const usage = assistantMsg?.usage;
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
                    if (msg.is_error &&
                        typeof msg.result === "string" &&
                        msg.result.includes("No conversation found")) {
                        session.claudeSessionId = null;
                        // Retry the query without resume
                        delete queryParams.options.resume;
                        session.isProcessing = false;
                        session.currentQuery = null;
                        this.handleUserMessage(session, text);
                        return;
                    }
                    session.claudeSessionId = msg.session_id;
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
                    console.log(`[session=${session.id}] Unhandled SDK message:`, msg.type, msg.subtype);
                }
            }
        }
        catch (err) {
            // User asked us to stop — the resulting AbortError / killed-child
            // error is expected, not a failure. Swallow the whole error path;
            // the stop handler already broadcast a clean "Stopped by user"
            // result and flipped the session to idle.
            if (session.userAborted) {
                // Fall through to the post-catch cleanup at the bottom of this
                // method, which resets isProcessing / abortController /
                // currentQuery and processes the next queued message (if any).
            }
            else {
                const rawMessage0 = err instanceof Error ? err.message : "Unknown error";
                // Resume-not-found surfaces here when the SDK throws DURING the
                // for-await loop (rather than yielding a result message with
                // is_error=true). Recover by wiping claudeSessionId and rerunning
                // handleUserMessage — the user sees one spinner cycle, not a
                // cryptic "No conversation found" error bubble.
                if (rawMessage0.toLowerCase().includes("no conversation found") ||
                    /returned an error result/i.test(rawMessage0)) {
                    session.claudeSessionId = null;
                    delete queryParams.options.resume;
                    session.isProcessing = false;
                    session.abortController = null;
                    session.currentQuery = null;
                    this.setStatus(session, "idle");
                    this.handleUserMessage(session, text);
                    return;
                }
                session.accumulatedText = "";
                const rawMessage = rawMessage0;
                const errnoErr = err;
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
                const setupRequired = errnoErr.code === "ENOENT" ||
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
                const authError = lowered.includes("authentication_error") ||
                    lowered.includes("invalid authentication credentials") ||
                    /\b401\b/.test(rawMessage) ||
                    lowered.includes("unauthorized");
                const stderrTail = typeof errnoErr.stderr === "string"
                    ? errnoErr.stderr
                        .trim()
                        .split(/\r?\n/)
                        .slice(-10)
                        .join("\n")
                    : undefined;
                if (authError) {
                    this.broadcast(session, {
                        type: "auth_required",
                        provider: "claude",
                        message: "Claude rejected the stored credentials (HTTP 401). Your OAuth " +
                            "token has probably expired — sign in again to keep chatting.",
                        hint: "Run `claude auth login` in the container terminal, or click below.",
                    });
                }
                else if (setupRequired) {
                    this.broadcast(session, {
                        type: "setup_required",
                        message: "Claude SDK could not be started. The bundled sdk.mjs may be missing or unreachable. " +
                            `Raw error: ${rawMessage}` +
                            (errnoErr.path ? ` (path=${errnoErr.path})` : ""),
                        ...(stderrTail ? { stderrTail } : {}),
                    });
                }
                else {
                    this.broadcast(session, {
                        type: "error",
                        message: rawMessage,
                        ...(errnoErr.code ? { errorCode: errnoErr.code } : {}),
                        ...(stderrTail ? { stderrTail } : {}),
                    });
                }
            } // end `else` — non-userAborted error path
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
            const next = session.messageQueue.shift();
            this.handleUserMessage(session, next.text);
        }
    }
    /**
     * Wait for a client response (permission or question answer) with timeout.
     * Auto-denies if no response is received within RESPONSE_TIMEOUT_MS.
     */
    waitForResponse(session, id) {
        return new Promise((resolve) => {
            // RESPONSE_TIMEOUT_MS <= 0 disables the safety timer completely —
            // the promise only resolves when a real permission_response /
            // ask_response / plan_response arrives. Useful for fully
            // background workflows where the user may not check back for
            // hours (or days) and we never want to auto-deny silently.
            const timer = RESPONSE_TIMEOUT_MS > 0
                ? setTimeout(() => {
                    session.pendingRequests.delete(id);
                    console.warn(`[session=${session.id}] Response timeout for request ${id}`);
                    this.setStatus(session, "thinking");
                    resolve({ allow: false, message: "Response timed out", answers: {} });
                }, RESPONSE_TIMEOUT_MS)
                : null;
            session.pendingRequests.set(id, (response) => {
                if (timer)
                    clearTimeout(timer);
                resolve(response);
            });
        });
    }
    broadcast(session, event) {
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
        // Tee into the cron run log if this session is an autonomous run.
        // Errors in the hook are deliberately swallowed — a failing log
        // writer must never break the SDK stream.
        if (session.cronOnEvent) {
            try {
                session.cronOnEvent(event);
            }
            catch {
                /* ignore */
            }
        }
        const data = JSON.stringify(event);
        for (const client of session.clients) {
            if (client.readyState === ws_1.WebSocket.OPEN) {
                client.send(data);
            }
        }
    }
    send(ws, event) {
        if (ws.readyState === ws_1.WebSocket.OPEN) {
            ws.send(JSON.stringify(event));
        }
    }
    /** Broadcast context usage from the final `result.modelUsage` (authoritative). */
    broadcastContextUsage(session, modelUsage) {
        if (!modelUsage || typeof modelUsage !== "object")
            return;
        const firstModel = Object.values(modelUsage)[0];
        if (!firstModel || !firstModel.contextWindow)
            return;
        const used = (firstModel.inputTokens || 0) +
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
    broadcastAssistantUsage(session, usage) {
        // The assistant message has raw API usage (input_tokens snake_case).
        const used = (usage.input_tokens || 0) +
            (usage.cache_read_input_tokens || 0) +
            (usage.cache_creation_input_tokens || 0);
        // Accumulate for cron token accounting — the sidecar stores the
        // total at run-end, not per-message. Out-of-band of any broadcast.
        if (session.cronPolicy) {
            session.cronTokenUsage.input += usage.input_tokens || 0;
            session.cronTokenUsage.output += usage.output_tokens || 0;
            session.cronTokenUsage.cacheRead += usage.cache_read_input_tokens || 0;
            session.cronTokenUsage.cacheCreate += usage.cache_creation_input_tokens || 0;
        }
        // Context window isn't in assistant usage — assume 1M.
        // The final `result` event corrects this with the real contextWindow from modelUsage.
        const max = 1000000;
        if (used === 0)
            return;
        this.broadcast(session, {
            type: "context_usage",
            used,
            max,
            percentage: Math.round((used / max) * 100),
        });
    }
    /**
     * Drive one autonomous run through the existing SDK pipeline. Sets up
     * session.cronPolicy so canUseTool takes the allowlist path, then calls
     * handleUserMessage and returns a promise that resolves when the SDK
     * emits its terminal result (or errors out).
     */
    runCron(args) {
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
        return new Promise((resolve) => {
            let settled = false;
            const settle = (outcome) => {
                if (settled)
                    return;
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
            session.cronAbortTimer = setTimeout(() => {
                try {
                    const q = session.currentQuery;
                    if (q?.interrupt) {
                        q.interrupt().catch(() => session.abortController?.abort());
                    }
                    else {
                        session.abortController?.abort();
                    }
                }
                catch {
                    /* best-effort abort */
                }
            }, Math.max(1, args.maxDurationSec) * 1000);
            this.handleUserMessage(session, args.prompt);
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
function handleTerminalConnection(ws, email) {
    let pty = null;
    try {
        const { shell, args } = (0, terminal_shell_1.resolveShell)();
        const lib = loadPty();
        pty = lib.spawn(shell, args, {
            name: "xterm-256color",
            cols: 80,
            rows: 24,
            cwd: process.env.CLAUDE_CWD || (0, os_1.homedir)(),
            env: process.env,
        });
        console.log(`[terminal] opened (${email}) using ${shell}`);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to start terminal";
        try {
            ws.send(`\r\n\x1b[31m[terminal] ${msg}\x1b[0m\r\n`);
        }
        catch {
            /* socket already dead */
        }
        try {
            ws.close();
        }
        catch {
            /* ignore */
        }
        return;
    }
    pty.onData((data) => {
        if (ws.readyState === ws_1.WebSocket.OPEN) {
            try {
                ws.send(data);
            }
            catch {
                /* closing */
            }
        }
    });
    pty.onExit(() => {
        try {
            ws.close();
        }
        catch {
            /* ignore */
        }
    });
    ws.on("message", (raw) => {
        const str = raw.toString();
        // Try to parse as a JSON control message first; fall back to raw stdin.
        if (str.length > 0 && str[0] === "{") {
            try {
                const msg = JSON.parse(str);
                if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
                    pty?.resize(Math.max(1, msg.cols | 0), Math.max(1, msg.rows | 0));
                    return;
                }
                if (msg.type === "close") {
                    pty?.kill();
                    return;
                }
            }
            catch {
                /* not JSON — treat as stdin */
            }
        }
        pty?.write(str);
    });
    ws.on("close", () => {
        console.log(`[terminal] closed (${email})`);
        try {
            pty?.kill();
        }
        catch {
            /* already dead */
        }
    });
}
/* ------------------------------------------------------------------ */
/*  Origin validation                                                  */
/* ------------------------------------------------------------------ */
function isOriginAllowed(origin) {
    // In dev mode, allow all origins
    if (dev)
        return true;
    // No origin header — could be a same-origin request or non-browser client
    if (!origin)
        return true;
    // Check explicit allowlist
    if (ALLOWED_ORIGINS.size > 0) {
        return ALLOWED_ORIGINS.has(origin);
    }
    // Default: allow same-host origins (any port)
    try {
        const url = new URL(origin);
        return (url.hostname === "localhost" || url.hostname === "127.0.0.1" || origin.includes(".viksi.ai"));
    }
    catch {
        return false;
    }
}
/* ------------------------------------------------------------------ */
/*  Start                                                              */
/* ------------------------------------------------------------------ */
const app = (0, next_1.default)({ dev });
const handle = app.getRequestHandler();
const sessionManager = new SessionManager();
// Publish the SessionManager via a module-level singleton so API routes
// can reach it even when the scheduler hasn't finished booting. This was
// the root cause of the "Run Now" 503s: the scheduler singleton was the
// only handle API routes had, and any transient bootstrap failure made
// manual runs unrunnable.
(0, session_manager_singleton_1.setSessionManager)(sessionManager);
// Rehydrate session state from disk so a container restart doesn't
// wipe every in-flight conversation. Runs synchronously (well, fire
// and log) before we start listening — if it fails we still come up,
// just with an empty session set.
(async () => {
    try {
        const persisted = await (0, session_persistence_1.loadAllSessions)();
        for (const p of persisted) {
            sessionManager.restoreFromDisk(p);
        }
        if (persisted.length > 0) {
            console.log(`> Restored ${persisted.length} chat session(s) from disk`);
        }
    }
    catch (err) {
        console.warn(`!! Could not rehydrate sessions: ${err.message}`);
    }
})();
// Bootstrap the reports scheduler. Sibling IIFE so a scheduler failure
// (e.g. corrupt .jobs/ directory) doesn't block chat from coming up.
(async () => {
    try {
        const scheduler = new scheduler_1.ReportScheduler(sessionManager);
        (0, scheduler_singleton_1.setScheduler)(scheduler);
        await scheduler.bootstrap();
    }
    catch (err) {
        console.warn(`!! Could not start reports scheduler: ${err.message}`);
    }
})();
app.prepare().then(() => {
    const server = (0, http_1.createServer)((req, res) => {
        const parsedUrl = (0, url_1.parse)(req.url || "/", true);
        handle(req, res, parsedUrl);
    });
    const wss = new ws_1.WebSocketServer({ noServer: true });
    // Let Next.js handle its own upgrade requests (HMR etc.)
    const nextUpgradeHandler = app.getUpgradeHandler();
    server.on("upgrade", async (req, socket, head) => {
        const { pathname, query: qs } = (0, url_1.parse)(req.url || "/", true);
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
        const sessionPayload = (0, auth_server_1.extractSessionFromCookieHeader)(req.headers.cookie);
        if (!sessionPayload) {
            const queryToken = qs.token;
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
        const sessionId = qs.session || "default";
        const cwdParam = qs.cwd || undefined;
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
                await (0, promises_1.access)(sdkEntry);
                let version = "(version unknown)";
                try {
                    const sdkPkg = JSON.parse((0, fs_1.readFileSync)((0, path_1.join)((0, path_1.dirname)(sdkEntry), "package.json"), "utf-8"));
                    if (sdkPkg.version)
                        version = `v${sdkPkg.version}`;
                }
                catch {
                    /* non-fatal */
                }
                console.log(`> SDK resolved: ${sdkEntry} (${version})`);
            }
            catch (err) {
                console.warn(`!! Could not resolve @anthropic-ai/claude-agent-sdk: ${err.message}. ` +
                    `Chat queries will fail. Inside the container, run 'npm install' in /app.`);
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
                    }
                    catch {
                        return null;
                    }
                })
                    .filter((h) => h !== null);
                if (chatHosts.includes(url.host) || url.host.startsWith("localhost")) {
                    console.warn(`!! NEXT_PUBLIC_API_ORIGIN (${API_ORIGIN}) looks like the chat's own host — login will 401. ` +
                        `Set it to the ClawOps backend URL (e.g. https://clawops.example.com) in /opt/claw-chat/.env ` +
                        `and 'docker compose up -d --force-recreate claw-chat'.`);
                    return;
                }
                const probe = await fetch(`${API_ORIGIN}/api/v1/auth/me`, {
                    headers: { Authorization: "Bearer boot-probe" },
                    signal: AbortSignal.timeout(5000),
                });
                if (probe.status !== 401 && probe.status !== 403) {
                    console.warn(`!! API_ORIGIN probe returned ${probe.status} (expected 401/403 for invalid token). ` +
                        `Check that ${API_ORIGIN} is reachable and speaks the ClawOps auth API.`);
                }
                else {
                    console.log(`> API_ORIGIN reachable (probe got ${probe.status} as expected)`);
                }
            }
            catch (err) {
                console.warn(`!! Could not reach API_ORIGIN=${API_ORIGIN}: ${err.message}. ` +
                    `Login + WebSocket auth will fail until the backend is reachable.`);
            }
        })();
    });
});
