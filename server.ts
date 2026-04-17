import "dotenv/config";
import { createServer, IncomingMessage } from "http";
import { parse } from "url";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { extractSessionFromCookieHeader, verifySession } from "./src/lib/auth-server";

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

/** Permission/question response timeout in ms (default: 5 minutes). */
const RESPONSE_TIMEOUT_MS = parseInt(process.env.RESPONSE_TIMEOUT_MS || "300000", 10);

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

/** Session cleanup delay after all clients disconnect (default: 60s). */
const SESSION_CLEANUP_MS = 60_000;

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
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  connect(ws: WebSocket, sessionId: string) {
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
      if (session.isProcessing) {
        session.messageQueue.push({ text });
      } else {
        this.handleUserMessage(session, text);
      }
      return;
    }

    if (type === "permission_response" || type === "ask_response") {
      const id = msg.id as string;
      const resolver = session.pendingRequests.get(id);
      if (resolver) {
        resolver(msg);
        session.pendingRequests.delete(id);
      }
      session.accumulatedText = "";
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
      cwd: process.env.CLAUDE_CWD || "/root",
      includePartialMessages: true,
      canUseTool: async (toolName: string, input: Record<string, unknown>) => {
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
        // Try to get the first message to detect resume failures early
        const first = await (messageStream as AsyncIterableIterator<unknown>).next();
        if (!first.done) {
          // Process the first message
          const msg = first.value as Record<string, unknown>;
          if (msg.type === "system" && msg.subtype === "init") {
            session.claudeSessionId = msg.session_id as string;
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
        } else {
          throw resumeErr;
        }
      }

      for await (const message of messageStream!) {
        const msg = message as Record<string, unknown>;

        // Session init
        if (msg.type === "system" && msg.subtype === "init") {
          session.claudeSessionId = msg.session_id as string;
          this.broadcast(session, { type: "session_init", sessionId: msg.session_id });
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

        // Assistant messages with completed tool uses
        if (msg.type === "assistant") {
          const assistantMsg = msg.message as Record<string, unknown>;
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
            permissionDenials: msg.permission_denials || [],
          });
          // Clear event history after turn completes — JSONL has the persisted record
          session.eventHistory = [];
          continue;
        }
      }
    } catch (err) {
      session.accumulatedText = "";
      const safeMessage = err instanceof Error ? err.message : "Unknown error";
      // Don't leak stack traces or internal paths to clients
      this.broadcast(session, {
        type: "error",
        message: safeMessage.includes("/") ? "Internal server error" : safeMessage,
      });
      console.error(`[session=${session.id}] Query error:`, err);
    }

    session.isProcessing = false;

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

  private broadcast(session: ChatSession, event: Record<string, unknown>) {
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

    const sessionId = (qs.session as string) || "default";

    wss.handleUpgrade(req, socket, head, (ws) => {
      sessionManager.connect(ws, sessionId);
    });
  });

  server.listen(port, () => {
    console.log(`> Claw Chat ready on http://localhost:${port}`);
    console.log(`> WebSocket endpoint: ws://localhost:${port}/ws/chat`);
  });
});
