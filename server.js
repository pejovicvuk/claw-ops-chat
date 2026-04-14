"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const http_1 = require("http");
const url_1 = require("url");
const next_1 = __importDefault(require("next"));
const ws_1 = require("ws");
const claude_agent_sdk_1 = require("@anthropic-ai/claude-agent-sdk");
const crypto_1 = require("crypto");
/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */
const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3100", 10);
const CLAW_CHAT_TOKEN = process.env.CLAW_CHAT_TOKEN;
if (!CLAW_CHAT_TOKEN) {
    console.error("FATAL: CLAW_CHAT_TOKEN environment variable is required");
    process.exit(1);
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
            };
            this.sessions.set(sessionId, session);
        }
        return session;
    }
    connect(ws, sessionId) {
        const session = this.getOrCreateSession(sessionId);
        session.clients.add(ws);
        // If sessionId looks like a UUID, set it as the claudeSessionId for resume
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!session.claudeSessionId && UUID_RE.test(sessionId)) {
            session.claudeSessionId = sessionId;
        }
        // Send current state to the new client
        this.send(ws, { type: "ready" });
        if (session.claudeSessionId) {
            this.send(ws, { type: "session_init", sessionId: session.claudeSessionId });
        }
        if (session.isProcessing) {
            this.send(ws, { type: "status", status: "thinking" });
        }
        ws.on("message", (data) => {
            try {
                const msg = JSON.parse(data.toString());
                this.handleMessage(session, ws, msg);
            }
            catch {
                // ignore malformed messages
            }
        });
        ws.on("close", () => {
            session.clients.delete(ws);
            // Clean up empty sessions after a delay
            if (session.clients.size === 0) {
                setTimeout(() => {
                    if (session.clients.size === 0 && !session.isProcessing) {
                        this.sessions.delete(session.id);
                    }
                }, 60000);
            }
        });
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
            cwd: process.env.CLAUDE_CWD || "/workspace",
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
                // Request permission from connected clients
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
            permissionMode: session.permissionMode,
            allowDangerouslySkipPermissions: session.permissionMode === "bypassPermissions",
            ...(session.effort ? { effort: session.effort } : {}),
        };
        const queryParams = { prompt: text, options: queryOptions };
        const resumeId = session.claudeSessionId;
        if (resumeId) {
            queryParams.options.resume = resumeId;
        }
        try {
            let messageStream;
            try {
                messageStream = (0, claude_agent_sdk_1.query)(queryParams);
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
                    messageStream = (0, claude_agent_sdk_1.query)(queryParams);
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
                            catch { /* empty */ }
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
                                    : Array.isArray(item.content) ? item.content.map((c) => c.text || "").join("") : "";
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
                // Assistant messages with completed tool uses
                if (msg.type === "assistant") {
                    const assistantMsg = msg.message;
                    const content = assistantMsg?.content;
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
                    session.claudeSessionId = msg.session_id;
                    session.accumulatedText = "";
                    this.broadcast(session, {
                        type: "result",
                        text: msg.result || "",
                        sessionId: msg.session_id,
                        isError: msg.is_error || false,
                        permissionDenials: msg.permission_denials || [],
                    });
                    continue;
                }
            }
        }
        catch (err) {
            session.accumulatedText = "";
            this.broadcast(session, {
                type: "error",
                message: err instanceof Error ? err.message : "Unknown error",
            });
        }
        session.isProcessing = false;
        // Process queued messages
        if (session.messageQueue.length > 0) {
            const next = session.messageQueue.shift();
            this.handleUserMessage(session, next.text);
        }
    }
    waitForResponse(session, id) {
        return new Promise((resolve) => {
            session.pendingRequests.set(id, resolve);
        });
    }
    broadcast(session, event) {
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
}
/* ------------------------------------------------------------------ */
/*  Token validation                                                   */
/* ------------------------------------------------------------------ */
function validateToken(token) {
    if (!CLAW_CHAT_TOKEN)
        return false;
    if (token.length !== CLAW_CHAT_TOKEN.length)
        return false;
    try {
        return (0, crypto_1.timingSafeEqual)(Buffer.from(token), Buffer.from(CLAW_CHAT_TOKEN));
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
    server.on("upgrade", (req, socket, head) => {
        const { pathname, query: qs } = (0, url_1.parse)(req.url || "/", true);
        if (pathname !== "/ws/chat" && pathname !== "/chat/ws/chat") {
            // Pass to Next.js for HMR and other internal WebSockets
            nextUpgradeHandler(req, socket, head);
            return;
        }
        const token = qs.token;
        if (!token || !validateToken(token)) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
        }
        const sessionId = qs.session || "default";
        wss.handleUpgrade(req, socket, head, (ws) => {
            sessionManager.connect(ws, sessionId);
        });
    });
    server.listen(port, () => {
        console.log(`> Claw Chat ready on http://localhost:${port}`);
        console.log(`> WebSocket endpoint: ws://localhost:${port}/ws/chat`);
    });
});
