# Runtime — `server.ts`

`server.ts` is the heart of the runtime. It runs a custom Node.js HTTP server
that wraps Next.js, plus four WebSocket endpoints, the Claude Agent SDK
session manager, the audit + cache cron jobs, and the rate-limit probe.

Compiled to `server.js` via `tsc server.ts` (part of `npm run build`); the
production image runs `node server.js`.

## Bootstrap order

`server.ts` does the following on startup, before `server.listen()`:

1. **Audit tree setup** — ensure `/root/.audit/{api,cron,session}` exist; run
   one immediate retention purge (delete files older than 30 days), then
   `cron.schedule("0 */6 * * *", ...)` for recurring 6-hour purge.
2. **Monitoring bootstrap** — start collectors, alert engine, automation
   engine, WebSocket broadcaster (`src/lib/monitoring/bootstrap.ts`).
3. **Google MCP tier migration** — one-shot for legacy users; rewrites
   `~/.claude.json` to the current MCP shape.
4. **Preview cache purge** — purge `/root/.cache/{unfurls,images}` once on
   boot, then `cron.schedule("30 */12 * * *", ...)` for every 12 hours.
5. **SDK probe** — version check + sanity import of `@anthropic-ai/claude-agent-sdk`.
6. **Self-loop guard** — warn if `NEXT_PUBLIC_API_ORIGIN` resolves to this
   process (would cause infinite proxy chain).
7. **Rate-limit probe** — `startRateLimitProbe()` polls the Spring backend
   for the user's account quota.
8. **`server.listen(port, ...)`** — port from `PORT` env (default 3100).

## HTTP

Next.js is wrapped, not bypassed:

```ts
const app = next({ dev, hostname: "0.0.0.0", port });
const handle = app.getRequestHandler();
await app.prepare();
const server = http.createServer((req, res) => handle(req, res, parse(req.url, true)));
```

All HTTP routes are under the `basePath: "/chat"` set in `next.config.ts`.
Health check: `GET /chat/api/health`.

## WebSocket endpoints

`server.on("upgrade", ...)` matches four pathnames (each with an optional
`/chat` prefix to handle the Next.js basePath):

| Path                | Purpose                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `/ws/chat`          | Claude streaming chat (the main one)                             |
| `/ws/terminal`      | Browser-based shell (node-pty); disabled if `DISABLE_TERMINAL=1` |
| `/ws/monitoring`    | Real-time monitoring metrics broadcast                           |
| `/ws/notifications` | Push notification fan-out for in-tab toasts                      |

Anything not matching is delegated to Next.js's HMR/dev WebSocket handler.

### Auth (chat / terminal / monitoring)

Two paths accepted:

1. **Signed session cookie** via `extractSessionFromCookieHeader()`
   (`src/lib/auth-server.ts`).
2. **Single-use ws-ticket** via `consumeWsTicket()`
   (`src/lib/ws-ticket-store.ts`). Tickets are minted by
   `GET /api/auth/ws-ticket` and live in memory for ~30 s. Used by the
   browser when the cookie is `HttpOnly` (which it is) — the client fetches a
   ticket, then puts it in the WebSocket URL: `?ticket=<uuid>`.

### Origin check

`origin` header validated against `ALLOWED_ORIGINS` (comma-separated env).
In dev, `localhost` is implicitly allowed.

### Heartbeat

30-second ping/pong on every chat WebSocket. A missed pong terminates the
socket; the client reconnects.

### Rate limit

Sliding 1-second window, **20 messages/sec per session** by default
(`WS_RATE_LIMIT` env override). Excess messages are dropped with an `error`
event back to the offending client.

## Chat WebSocket protocol

### Client → server messages

| `type`                | Payload                                              |
| --------------------- | ---------------------------------------------------- | --------- | -------------- | ------------------- | --------- |
| `message`             | `{ text, attachments?, sessionCwd? }` — user prompt  |
| `permission_response` | `{ id, decision: "allow"                             | "deny" }` |
| `ask_response`        | `{ id, answer }`                                     |
| `plan_response`       | `{ id, decision: "approve"                           | "edit"    | "reject", … }` |
| `stop`                | Abort current turn (also denies any pending request) |
| `set_effort`          | `{ effort: "low"                                     | "medium"  | "high"         | null }`             |
| `set_mode`            | `{ mode: "default"                                   | "plan"    | "acceptEdits"  | "bypassPermissions" | "auto" }` |

### Server → client events

| `type`               | Description                                                                     |
| -------------------- | ------------------------------------------------------------------------------- |
| `ready`              | WebSocket attached, replay (if any) about to start                              |
| `session_init`       | SDK session created/resumed; carries `claudeSessionId`                          |
| `status`             | `idle` / `thinking` / `tool_running` / `awaiting_permission` / `awaiting_input` |
| `text_delta`         | Streamed assistant text chunk                                                   |
| `thinking_delta`     | Streamed extended-thinking text chunk                                           |
| `tool_use_start`     | Tool input fully accumulated; about to run                                      |
| `tool_result`        | One block of a tool result (multi-block tools emit multiple)                    |
| `tool_use_complete`  | Tool finished; carries final input + result                                     |
| `result`             | Turn finished; carries final usage + stop reason                                |
| `permission_request` | `{ id, toolName, input }` — server awaiting `permission_response`               |
| `ask_question`       | `{ id, prompt, options? }` — server awaiting `ask_response`                     |
| `plan_proposal`      | `{ id, plan }` — server awaiting `plan_response`                                |
| `mode_changed`       | New permission mode acknowledged                                                |
| `effort_changed`     | New thinking effort acknowledged                                                |
| `interrupted`        | Turn was aborted                                                                |
| `error`              | Anything else (rate limit, SDK error, decode error, …)                          |
| `compact_boundary`   | Context window was compacted by the SDK                                         |

## SessionManager

A single `SessionManager` owns all in-memory `ChatSession` objects, keyed by
the client-provided session UUID (which the server aliases to the SDK-issued
session id once known).

### `ChatSession` shape (essentials)

| Field                                                                             | Purpose                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `id`                                                                              | Client-provided UUID                                                |
| `claudeSessionId`                                                                 | SDK-issued id, set after first `system/init` message                |
| `sessionCwd`, `branchName`                                                        | Working directory + git branch label for the sidebar                |
| `clients: Set<WebSocket>`                                                         | Connected tabs (one logical session can have many clients)          |
| `isProcessing`, `messageQueue`                                                    | Serialize user messages during a turn                               |
| `pendingRequests: Map<id, resolver>`                                              | Awaiting permission/ask/plan responses                              |
| `sessionAllowedTools: Set<string>`                                                | Per-session pre-approval cache for `canUseTool`                     |
| `permissionMode`                                                                  | `default` / `plan` / `acceptEdits` / `bypassPermissions` / `auto`   |
| `eventHistory`                                                                    | Replayed to reconnecting clients (kept lossless for resume)         |
| `status: SessionStatus`                                                           | Mirrored to `/root/.session-status/<id>.json` (microtask coalesced) |
| `cronPolicy`, `cronOnComplete`, `cronOnEvent`, `cronAbortTimer`, `cronTokenUsage` | Set when this session is owned by a scheduled report run            |
| `lastUserMessage`, `displayPreview`                                               | Sidebar preview text                                                |
| `wasInterrupted`                                                                  | Boot recovery flag — true if the prior turn was mid-flight          |
| `abortController`, `currentQuery`                                                 | Turn-level abort + active SDK iterator                              |

### Lifecycle

1. **`getOrCreateSession(sessionId)`** — fetch or build the session record.
2. **`connect(ws, sessionId, cwd, actorEmail, clientMeta)`** — attach a
   WebSocket, refresh git branch, replay event history, set up heartbeat +
   message handler.
3. **`handleUserMessage(session, text)`** — set status to `thinking` →
   call `query()` → iterate `messageStream` → broadcast → drain
   `messageQueue` if more arrived during the turn.
4. **`waitForResponse(session, id)`** — Promise that resolves when the
   client posts a `permission_response`/`ask_response`/`plan_response`. Times
   out after `RESPONSE_TIMEOUT_MS` (default 24 h) with a deny response.
5. **`disconnect(ws)`** — drop from `clients`. Sessions stay in memory; we
   only persist the status snapshot.
6. **`restoreFromDisk(persisted)`** — at boot, rehydrate event history and
   set `wasInterrupted` if the prior status was non-idle. Status is forced to
   `idle` on rehydration.

### Disk persistence

- **Session status** — `/root/.session-status/<id>.json`; written via
  `queuePersist()` → coalesced microtask → `persistNow()`.
- **Claude transcript** — owned by the SDK at
  `~/.claude/projects/<project-hash>/<sessionId>.jsonl`. We do not write to
  it directly.
- **Per-session permission cache** — held in memory; not persisted.

## Claude Agent SDK integration

The SDK is loaded via `sdk-loader.js`, a CJS shim that prevents esbuild from
trying to ESM-transform the package. Each turn calls:

```ts
messageStream = query({
  prompt: text,
  options: {
    cwd: session.sessionCwd || process.env.CLAUDE_CWD || homedir(),
    resume: session.claudeSessionId, // resume from JSONL if known
    includePartialMessages: true,
    thinking: { type: "adaptive" }, // unless effort is set explicitly
    permissionMode: session.permissionMode,
    canUseTool: async (toolName, input) => {
      /* permission gate — see below */
    },
    mcpServers: loadMcpServers(), // re-read ~/.claude.json each turn
    systemPrompt: { preset: "claude_code", append: customPrompt },
    settingSources: ["project"],
    env: { ...parentEnv, JIRA_*, TRELLO_* },
    spawnClaudeCodeProcess: spawnClaude,
    abortController,
  },
});
```

### `messageStream` events handled

- `system/init` → set `claudeSessionId`, broadcast `session_init`, alias session
- `system/compact_boundary` → broadcast `compact_boundary`
- `stream_event/content_block_delta/text_delta` → broadcast `text_delta`
- `stream_event/content_block_delta/thinking_delta` → broadcast `thinking_delta`
- `stream_event/content_block_start/tool_use` → start tool input accumulation
- `stream_event/content_block_delta/input_json_delta` → accumulate input JSON
- `stream_event/content_block_stop` → broadcast `tool_use_start` (input now complete)
- `user` (tool result frames) → broadcast `tool_result` per content block
- `assistant` → broadcast `tool_use_complete` for each tool, update token usage
- `result` → broadcast `result`, drain message queue

### Permission gates (`canUseTool`)

Order of checks:

1. If `cronPolicy` is set, delegate to `decideCronTool()` from
   `src/lib/reports/tool-policy.ts` — no interactive prompts, just allow/deny.
2. Bypass mode: `permissionMode === "bypassPermissions"` → allow everything.
3. Plan mode: read-only tools allow; writes/exec require an approved plan.
4. AcceptEdits mode: allow file edits; everything else still prompts.
5. Auto mode: similar to acceptEdits but more aggressive (allows more tool families).
6. Otherwise: check `sessionAllowedTools`; if hit → allow. Else send
   `permission_request` and `await waitForResponse(...)`.

### Resume logic

- First message with a `claudeSessionId` → `query({ resume })`.
- If the SDK throws "No conversation found", retry with `resume: undefined`
  (capped at 2 retries to avoid loops).
- A successful `system/init` may carry a different SDK session id — the
  session is then **aliased** so that reconnects under either id land on the
  same in-memory record.

### Token usage tracking

Each `assistant` message carries a `usage` block. We update
`broadcastAssistantUsage()` with `input_tokens`, `cache_read_input_tokens`,
`cache_creation_input_tokens`. Tracked in-session for sidebar display.

## Cron jobs registered at boot

Both use `node-cron` and run synchronously inside the server process.

| Schedule        | Job                                  | Source                                        |
| --------------- | ------------------------------------ | --------------------------------------------- |
| `0 */6 * * *`   | Audit retention (delete >30 d files) | `src/lib/audit/retention.ts`                  |
| `30 */12 * * *` | Preview cache purge (unfurl + image) | `src/lib/proxy/{unfurl-cache,image-cache}.ts` |

The reports `ReportScheduler` runs separately (see
[subsystems.md#reports-scheduled-claude-jobs](./subsystems.md#reports-scheduled-claude-jobs)) — it is also started during
bootstrap but registers cron entries dynamically per job.

## Environment variables

Defined / read in `server.ts`:

| Var                      | Default                    | Purpose                                    |
| ------------------------ | -------------------------- | ------------------------------------------ |
| `PORT`                   | `3100`                     | HTTP / WebSocket port                      |
| `NODE_ENV`               | `production`               | `dev` mode if any other value              |
| `ALLOWED_EMAIL`          | _(required)_               | Single-user email gate                     |
| `NEXT_PUBLIC_API_ORIGIN` | `http://localhost:8080`    | Spring backend origin (scheme + host)      |
| `ALLOWED_ORIGINS`        | _(empty → localhost-only)_ | Comma-separated WebSocket origins          |
| `WS_RATE_LIMIT`          | `20`                       | Messages/sec per chat session              |
| `RESPONSE_TIMEOUT_MS`    | `86400000` (24 h)          | Max wait for permission/ask/plan responses |
| `CLAUDE_CWD`             | `homedir()`                | Default working directory for SDK queries  |
| `CLAUDE_THINKING`        | (any non-`off`)            | Set to `off` to disable adaptive thinking  |
| `DISABLE_TERMINAL`       | `0`                        | `1` disables `/ws/terminal`                |
| `DEBUG_SDK_STREAM`       | `0`                        | Logs raw SDK message stream when set       |
| `SESSION_SECRET`         | auto-generated             | HMAC key for session cookies               |

## Persistence locations on disk

Inside the container these are under `/root` (bound to the host as a single
volume in `docker-compose.yml`):

| Path                                                | What                                                |
| --------------------------------------------------- | --------------------------------------------------- |
| `/root/.audit/{api,cron,session}/YYYY-MM-DD.jsonl`  | Audit log files (rotated daily, purged after 30 d)  |
| `/root/.cache/unfurls/<sha256>.json`                | Unfurl cache (24 h TTL, 10 k file cap)              |
| `/root/.cache/images/<sha256>.<ext>` + `.meta.json` | Image cache (7 d TTL, 1 GB cap)                     |
| `/root/.session-status/<id>.json`                   | SessionManager status snapshot                      |
| `/root/.claude/projects/<hash>/<id>.jsonl`          | SDK session transcripts (managed by SDK)            |
| `/root/.claude/.credentials.json`                   | Claude IDE credentials (read-only mount in compose) |
| `/root/.push/vapid.json`                            | Web Push VAPID keypair                              |

## Where to look in `server.ts`

Approximate line numbers (file is ~2,685 lines):

| Concern                        | Lines     |
| ------------------------------ | --------- |
| Env reads                      | 110–175   |
| `query()` invocation           | 1043–1425 |
| `messageStream` for-await loop | 1426–1700 |
| `SessionManager`               | 363–2330  |
| Audit retention cron           | 2379      |
| Preview cache purge cron       | 2423      |
| `app.prepare()` + bootstrap    | 2441–2603 |
| `server.on("upgrade")`         | 2475      |
| WebSocket pathname matching    | 2478–2516 |
| `server.listen()`              | 2603      |

When in doubt, search for the broadcast event name (`tool_use_start`,
`permission_request`, etc.) — that lands you on the producer.
