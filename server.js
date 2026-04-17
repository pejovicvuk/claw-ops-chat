"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const http_1 = require("http");
const url_1 = require("url");
const fs_1 = require("fs");
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
// Bundled cli.js path with forward slashes — Windows backslashes break Node spawn.
const SDK_CLI_PATH = (0, path_1.join)((0, path_1.dirname)(require.resolve("@anthropic-ai/claude-agent-sdk")), "cli.js")
    .split(path_1.sep)
    .join("/");
// Custom spawn that normalizes paths (fixes Windows backslash ENOENT).
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
/** Permission/question response timeout in ms (default: 5 minutes). */
const RESPONSE_TIMEOUT_MS = parseInt(process.env.RESPONSE_TIMEOUT_MS || "300000", 10);
/* Load MCP servers from ~/.claude.json */
let mcpServers;
try {
    const claudeJson = JSON.parse((0, fs_1.readFileSync)((0, path_1.join)((0, os_1.homedir)(), ".claude.json"), "utf-8"));
    if (claudeJson.mcpServers && Object.keys(claudeJson.mcpServers).length > 0) {
        mcpServers = claudeJson.mcpServers;
        console.log(`> Loaded MCP servers: ${Object.keys(mcpServers).join(", ")}`);
    }
}
catch {
    // No ~/.claude.json or invalid — continue without MCP
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
                sessionCwd: null,
            };
            this.sessions.set(sessionId, session);
        }
        return session;
    }
    connect(ws, sessionId, sessionCwd) {
        const session = this.getOrCreateSession(sessionId);
        session.clients.add(ws);
        // If sessionId looks like a UUID, set it as the claudeSessionId for resume
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!session.claudeSessionId && UUID_RE.test(sessionId)) {
            session.claudeSessionId = sessionId;
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
        if (session.isProcessing) {
            this.send(ws, { type: "status", status: "thinking" });
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
            if (session.isProcessing) {
                session.messageQueue.push({ text });
            }
            else {
                this.handleUserMessage(session, text);
            }
            return;
        }
        if (type === "permission_response" || type === "ask_response") {
            const id = msg.id;
            const resolver = session.pendingRequests.get(id);
            if (resolver) {
                resolver(msg);
                session.pendingRequests.delete(id);
            }
            session.accumulatedText = "";
            return;
        }
        if (type === "stop") {
            if (session.abortController && session.isProcessing) {
                session.abortController.abort();
                this.broadcast(session, { type: "result", text: "Stopped by user", isError: false });
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
        const queryOptions = {
            // Prefer the original cwd from JSONL (for resume to find the session file).
            // Fall back to CLAUDE_CWD env, then homedir() (works cross-platform).
            // `/root` (Docker default) doesn't exist on Windows/Mac and causes spawn ENOENT.
            cwd: session.sessionCwd || process.env.CLAUDE_CWD || (0, os_1.homedir)(),
            includePartialMessages: true,
            canUseTool: async (toolName, input) => {
                // Handle AskUserQuestion
                if (toolName === "AskUserQuestion") {
                    const id = `req-${++session.requestCounter}`;
                    this.broadcast(session, { type: "ask_question", id, questions: input.questions || [] });
                    this.broadcast(session, { type: "status", status: "awaiting_input" });
                    const response = await this.waitForResponse(session, id);
                    this.broadcast(session, { type: "status", status: "thinking" });
                    return {
                        behavior: "allow",
                        updatedInput: { questions: input.questions || [], answers: response.answers || {} },
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
                this.broadcast(session, { type: "status", status: "awaiting_permission" });
                const response = await this.waitForResponse(session, id);
                this.broadcast(session, { type: "status", status: "tool_running" });
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
            abortController,
            pathToClaudeCodeExecutable: SDK_CLI_PATH,
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
                // Try to get the first message to detect resume failures early
                const first = await messageStream.next();
                if (!first.done) {
                    // Process the first message
                    const msg = first.value;
                    if (msg.type === "system" && msg.subtype === "init") {
                        session.claudeSessionId = msg.session_id;
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
                    this.broadcast(session, { type: "session_init", sessionId: msg.session_id });
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
                // Assistant messages with completed tool uses or final text response
                if (msg.type === "assistant") {
                    const assistantMsg = msg.message;
                    // Broadcast live context usage from assistant usage field.
                    // The assistant.message.usage has input_tokens, cache_read_input_tokens, cache_creation_input_tokens.
                    const usage = assistantMsg?.usage;
                    if (usage) {
                        this.broadcastAssistantUsage(session, usage);
                    }
                    const content = assistantMsg?.content;
                    let hasToolUse = false;
                    let textContent = "";
                    if (Array.isArray(content)) {
                        for (const block of content) {
                            if (block.type === "tool_use") {
                                hasToolUse = true;
                                this.broadcast(session, {
                                    type: "tool_use_complete",
                                    id: block.id,
                                    name: block.name,
                                    input: block.input,
                                });
                            }
                            if (block.type === "text" && block.text) {
                                textContent += block.text;
                            }
                        }
                    }
                    // If the assistant message has text but no tool_use, it's the final response.
                    // The SDK may not send a separate "result" event — treat this as completion.
                    if (!hasToolUse && textContent) {
                        session.claudeSessionId = msg.session_id || session.claudeSessionId;
                        session.accumulatedText = "";
                        this.broadcast(session, {
                            type: "result",
                            text: textContent,
                            sessionId: session.claudeSessionId,
                            isError: false,
                        });
                        session.eventHistory = [];
                        // Close the stream — the SDK won't send a "result" event
                        try {
                            messageStream.close?.();
                        }
                        catch {
                            /* already closed */
                        }
                        break;
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
                        permissionDenials: msg.permission_denials || [],
                    });
                    this.broadcastContextUsage(session, msg.modelUsage);
                    // Clear event history after turn completes — JSONL has the persisted record
                    session.eventHistory = [];
                    continue;
                }
            }
        }
        catch (err) {
            session.accumulatedText = "";
            const rawMessage = err instanceof Error ? err.message : "Unknown error";
            console.error(`[session=${session.id}] Query error:`, err);
            // Detect SDK executable-not-found errors and send a special type
            // so the client can show the install popup instead of a generic error.
            if (rawMessage.includes("executable not found") ||
                rawMessage.includes("native binary not found")) {
                this.broadcast(session, {
                    type: "setup_required",
                    message: "Claude Code CLI could not be started. The SDK bundled binary may be missing or incompatible.",
                });
            }
            else {
                const safeMessage = rawMessage.includes("/") ? "Internal server error" : rawMessage;
                this.broadcast(session, { type: "error", message: safeMessage });
            }
        }
        session.isProcessing = false;
        session.abortController = null;
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
            const timer = setTimeout(() => {
                session.pendingRequests.delete(id);
                console.warn(`[session=${session.id}] Response timeout for request ${id}`);
                this.broadcast(session, { type: "status", status: "thinking" });
                resolve({ allow: false, message: "Response timed out", answers: {} });
            }, RESPONSE_TIMEOUT_MS);
            session.pendingRequests.set(id, (response) => {
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
        // Context window isn't in assistant usage — infer from observed usage.
        // If usage exceeds 200k, it must be a 1M variant; otherwise assume 200k.
        // The final `result` event corrects this with the real contextWindow.
        const max = used > 200000 ? 1000000 : 200000;
        if (used === 0)
            return;
        this.broadcast(session, {
            type: "context_usage",
            used,
            max,
            percentage: Math.round((used / max) * 100),
        });
    }
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
        if (pathname !== "/ws/chat" && pathname !== "/chat/ws/chat") {
            // Pass to Next.js for HMR and other internal WebSockets
            nextUpgradeHandler(req, socket, head);
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
        const sessionId = qs.session || "default";
        const cwdParam = qs.cwd || undefined;
        wss.handleUpgrade(req, socket, head, (ws) => {
            sessionManager.connect(ws, sessionId, cwdParam);
        });
    });
    server.listen(port, () => {
        console.log(`> Claw Chat ready on http://localhost:${port}`);
        console.log(`> WebSocket endpoint: ws://localhost:${port}/ws/chat`);
    });
});
