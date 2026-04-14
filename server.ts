import { createServer, IncomingMessage } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { timingSafeEqual } from "crypto";

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
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChatSession {
  id: string;
  clients: Set<WebSocket>;
  claudeSessionId: string | null;
  isProcessing: boolean;
  messageQueue: Array<{ text: string; resumeId?: string }>;
  pendingRequests: Map<string, (response: Record<string, unknown>) => void>;
  sessionAllowedTools: Set<string>;
  permissionMode: string;
  effort: string | null;
  requestCounter: number;
  accumulatedText: string;
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
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  connect(ws: WebSocket, sessionId: string) {
    const session = this.getOrCreateSession(sessionId);
    session.clients.add(ws);

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
      } catch {
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

  private handleMessage(session: ChatSession, _ws: WebSocket, msg: Record<string, unknown>) {
    const type = msg.type as string;

    if (type === "message") {
      const text = msg.text as string;
      const resumeId = msg.sessionId as string | undefined;
      if (session.isProcessing) {
        session.messageQueue.push({ text, resumeId });
      } else {
        this.handleUserMessage(session, text, resumeId);
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

  private async handleUserMessage(session: ChatSession, text: string, resumeClaudeSessionId?: string) {
    session.isProcessing = true;
    session.accumulatedText = "";
    let toolInputAccum = "";
    let pendingToolUse: { id: string; name: string } | null = null;

    const getToolDescription = (toolName: string, input: Record<string, unknown>): string => {
      if (toolName === "Bash" && input.command) return (input.command as string).slice(0, 120);
      if (["Read", "Write", "Edit"].includes(toolName) && input.file_path) return input.file_path as string;
      if (toolName === "Grep" && input.pattern) return `pattern: ${input.pattern}`;
      if (toolName === "Glob" && input.pattern) return `pattern: ${input.pattern}`;
      return "";
    };

    const queryOptions: Record<string, unknown> = {
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

    const queryParams: Record<string, unknown> = { prompt: text, options: queryOptions };
    const resumeId = resumeClaudeSessionId || session.claudeSessionId;
    if (resumeId) {
      (queryParams.options as Record<string, unknown>).resume = resumeId;
    }

    try {
      for await (const message of query(queryParams as Parameters<typeof query>[0])) {
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
              try { parsedInput = JSON.parse(toolInputAccum); } catch { /* empty */ }
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
                const resultContent = typeof item.content === "string"
                  ? item.content
                  : Array.isArray(item.content) ? item.content.map((c: Record<string, unknown>) => c.text || "").join("") : "";
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
          session.claudeSessionId = msg.session_id as string;
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
    } catch (err) {
      session.accumulatedText = "";
      this.broadcast(session, {
        type: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }

    session.isProcessing = false;

    // Process queued messages
    if (session.messageQueue.length > 0) {
      const next = session.messageQueue.shift()!;
      this.handleUserMessage(session, next.text, next.resumeId);
    }
  }

  private waitForResponse(session: ChatSession, id: string): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      session.pendingRequests.set(id, resolve);
    });
  }

  private broadcast(session: ChatSession, event: Record<string, unknown>) {
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
/*  Token validation                                                   */
/* ------------------------------------------------------------------ */

function validateToken(token: string): boolean {
  if (!CLAW_CHAT_TOKEN) return false;
  if (token.length !== CLAW_CHAT_TOKEN.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(CLAW_CHAT_TOKEN));
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

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const { pathname, query: qs } = parse(req.url || "/", true);

    if (pathname !== "/ws/chat") {
      socket.destroy();
      return;
    }

    const token = qs.token as string;
    if (!token || !validateToken(token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
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
