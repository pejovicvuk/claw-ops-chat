import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { getChatSendHandle } from "@/lib/chat-send-singleton";

const MAX_TEXT_LEN = 200_000;
const MAX_SESSION_ID_LEN = 200;
const MAX_CLIENT_MSG_ID_LEN = 200;

/**
 * Deliver a user message to a chat session. Used in place of the
 * WebSocket "message" frame so the send survives tab close / navigation
 * via `fetch(..., { keepalive: true })` on the client. The streaming
 * response still arrives over the WebSocket — this route is upload-only.
 *
 * Body: { sessionId, text, clientMessageId, sessionCwd? }
 *   - sessionId        — same id the WS uses (legacy "new-…" or UUID)
 *   - text             — the user's message
 *   - clientMessageId  — UUID v4; used as idempotency key (prevents the
 *                        same message from being processed twice if the
 *                        browser retries an in-flight keepalive request)
 *   - sessionCwd       — optional cwd hint for fresh sessions
 *
 * Status codes:
 *   200 { ok: true, duplicate?: boolean }  — accepted (or already seen)
 *   400 { error }                          — bad payload
 *   429 { error: "Rate limited" }          — > WS_RATE_LIMIT msgs/sec
 *   503 { error: "Chat service unavailable" } — server.ts not yet booted
 */
async function postHandler(request: Request): Promise<Response> {
  const session = extractSession(request);
  if (!session) return unauthorized();

  let body: {
    sessionId?: unknown;
    text?: unknown;
    clientMessageId?: unknown;
    sessionCwd?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const text = typeof body.text === "string" ? body.text : "";
  const clientMessageId =
    typeof body.clientMessageId === "string" ? body.clientMessageId.trim() : "";
  const sessionCwd = typeof body.sessionCwd === "string" ? body.sessionCwd : null;

  if (!sessionId || sessionId.length > MAX_SESSION_ID_LEN) {
    return Response.json({ error: "sessionId is required" }, { status: 400 });
  }
  if (!clientMessageId || clientMessageId.length > MAX_CLIENT_MSG_ID_LEN) {
    return Response.json({ error: "clientMessageId is required" }, { status: 400 });
  }
  if (!text.trim()) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LEN) {
    return Response.json({ error: "Message too long" }, { status: 400 });
  }

  const handle = getChatSendHandle();
  if (!handle) {
    return Response.json({ error: "Chat service unavailable" }, { status: 503 });
  }

  const result = handle.enqueueUserMessage({
    sessionId,
    text,
    clientMessageId,
    actorEmail: session.email,
    sessionCwd,
  });

  if (result.rateLimited) {
    return Response.json({ error: "Rate limited" }, { status: 429 });
  }
  return Response.json({ ok: true, duplicate: result.duplicate ?? false });
}

export const POST = withAudit({ route: "/api/chat/send", label: "Chat message send" }, postHandler);
