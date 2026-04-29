# API Routes

Every `route.ts` under `src/app/api/`, grouped by feature. All routes are
served under the `/chat` basePath (so `route.ts` at `src/app/api/health` is
reachable at `GET /chat/api/health`).

**Conventions** (enforced via `.claude/rules/api-routes.md`):

- Every handler MUST call `extractSession(request)` first and return
  `unauthorized()` on null. Sole exception: `/api/health`.
- File paths from user input MUST go through `safePath()` from `src/lib/safe-path.ts`.
- Success: `Response.json(data)`; error: `Response.json({ error }, { status })`.
- State-changing routes wrap the handler with `withAudit({...}, handler)` from
  `src/lib/audit/api-wrap.ts` to emit `request_complete`/`request_error` events.

Auth column legend: `S` = session cookie, `S+T` = session OR ws-ticket,
`open` = no auth required.

---

## Auth & sessions

| Route                          | Methods       | Auth | Purpose                                                             |
| ------------------------------ | ------------- | ---- | ------------------------------------------------------------------- |
| `/api/auth/session`            | POST / DELETE | S    | Establish (POST) or destroy (DELETE) session cookie after JWT login |
| `/api/auth/ws-ticket`          | GET           | S    | Mint a single-use ticket UUID for WebSocket authentication          |
| `/api/claude-auth/login`       | POST          | S    | Begin Claude IDE OAuth flow                                         |
| `/api/claude-auth/submit-code` | POST          | S    | Submit OAuth code from device flow                                  |
| `/api/claude-auth/cancel`      | POST          | S    | Cancel pending Claude OAuth flow                                    |
| `/api/claude-auth/logout`      | POST          | S    | Clear Claude session                                                |
| `/api/claude-auth/status`      | GET           | S    | Current Claude IDE auth state                                       |

## Files

All write/upload routes call `safePath()` / `safeFilename()`. Read endpoints
also enforce path safety. Max read size: 1 MB unless otherwise noted.

| Route                 | Methods | Auth | Purpose                                                            |
| --------------------- | ------- | ---- | ------------------------------------------------------------------ |
| `/api/files/list`     | GET     | S    | Directory listing with metadata                                    |
| `/api/files/read`     | GET     | S    | Read file (text); 1 MB cap                                         |
| `/api/files/write`    | POST    | S    | Write file; audit-logged                                           |
| `/api/files/upload`   | POST    | S    | Upload (single or batch); validates each filename                  |
| `/api/files/download` | GET     | S    | Stream a file as `attachment`; consumed by `<a download>`          |
| `/api/files/serve`    | GET     | S    | Serve a file inline with correct `Content-Type` (used by previews) |
| `/api/files/delete`   | POST    | S    | Delete file or directory                                           |
| `/api/files/mkdir`    | POST    | S    | Create directory                                                   |
| `/api/files/search`   | GET     | S    | Recursive search; respects `.gitignore`-style excludes             |
| `/api/files/stat`     | GET     | S    | Lightweight `{ size, mtime, mime, isDir }` for inline previews     |

## Git

Reads only — writes happen via Claude tools or the host shell.

| Route                  | Methods | Auth | Purpose                                       |
| ---------------------- | ------- | ---- | --------------------------------------------- |
| `/api/git/status`      | GET     | S    | Working-tree status (porcelain parsed)        |
| `/api/git/log`         | GET     | S    | Commit history with pagination                |
| `/api/git/diff`        | GET     | S    | Unified diff (working tree vs HEAD or staged) |
| `/api/git/commit-diff` | GET     | S    | Diff for a specific commit                    |
| `/api/git/branches`    | GET     | S    | List branches                                 |

## Sessions

| Route                         | Methods      | Auth | Purpose                                                       |
| ----------------------------- | ------------ | ---- | ------------------------------------------------------------- |
| `/api/sessions`               | GET          | S    | List Claude Code sessions in the current cwd                  |
| `/api/sessions/[id]`          | GET / DELETE | S    | Get or delete a session (DELETE removes JSONL + status files) |
| `/api/sessions/[id]/messages` | GET / POST   | S    | Read message history; POST appends user message               |
| `/api/sessions/branches`      | GET          | S    | Active sessions + their detected git branches                 |
| `/api/sessions/status`        | GET          | S    | Live session statuses for the sidebar                         |

## Audit

| Route                    | Methods | Auth | Purpose                                                                 |
| ------------------------ | ------- | ---- | ----------------------------------------------------------------------- |
| `/api/audit/events`      | GET     | S    | Paginated event list (newest first; filters: category, severity, dates) |
| `/api/audit/events/[id]` | GET     | S    | Single event detail                                                     |
| `/api/audit/stats`       | GET     | S    | Counts by category / severity                                           |
| `/api/audit/export`      | POST    | S    | Export filtered events to JSON or CSV                                   |

## Monitoring

| Route                                         | Methods        | Auth | Purpose                                    |
| --------------------------------------------- | -------------- | ---- | ------------------------------------------ |
| `/api/monitoring/overview`                    | GET            | S    | System health snapshot                     |
| `/api/monitoring/health`                      | GET            | S    | Health status + thresholds                 |
| `/api/monitoring/health/series`               | GET            | S    | Health metric ring buffer (time series)    |
| `/api/monitoring/system`                      | GET            | S    | Load avg, mem, disk                        |
| `/api/monitoring/processes`                   | GET            | S    | Top processes by CPU/memory                |
| `/api/monitoring/docker`                      | GET            | S    | Container list + status                    |
| `/api/monitoring/docker/[id]/action`          | POST           | S    | Start / stop / restart container           |
| `/api/monitoring/docker/[id]/logs`            | GET            | S    | Container logs                             |
| `/api/monitoring/apm`                         | GET            | S    | Request latency / error rate               |
| `/api/monitoring/cron`                        | GET            | S    | Cron schedule + last runs                  |
| `/api/monitoring/logs`                        | GET            | S    | Aggregated app logs                        |
| `/api/monitoring/snapshot`                    | GET            | S    | Full snapshot (all subsystems, one shot)   |
| `/api/monitoring/ws`                          | GET            | S    | List active monitoring WebSocket clients   |
| `/api/monitoring/ws/[id]/disconnect`          | POST           | S    | Disconnect a specific monitoring WS client |
| `/api/monitoring/alerts`                      | GET            | S    | List alert rules                           |
| `/api/monitoring/alerts/[id]`                 | GET/PUT/DELETE | S    | CRUD a rule                                |
| `/api/monitoring/alerts/[id]/ack`             | POST           | S    | Ack an alert                               |
| `/api/monitoring/alerts/[id]/snooze`          | POST           | S    | Snooze an alert                            |
| `/api/monitoring/alerts/bulk-ack`             | POST           | S    | Ack many at once                           |
| `/api/monitoring/alerts/history`              | GET            | S    | Alert event history                        |
| `/api/monitoring/automation`                  | GET / POST     | S    | List / create automation rules             |
| `/api/monitoring/automation/[id]`             | GET/PUT/DELETE | S    | CRUD an automation rule                    |
| `/api/monitoring/automation/[id]/run`         | POST           | S    | Trigger automation immediately             |
| `/api/monitoring/automation/runs`             | GET            | S    | Run history                                |
| `/api/monitoring/automation/restore-defaults` | POST           | S    | Restore default automation rules           |
| `/api/monitoring/actions/force-gc`            | POST           | S    | Force V8 GC                                |
| `/api/monitoring/actions/heap-snapshot`       | POST           | S    | Capture a heap snapshot                    |
| `/api/monitoring/actions/kill-process`        | POST           | S    | Kill process by PID                        |
| `/api/monitoring/maintenance`                 | GET / POST     | S    | List / schedule maintenance windows        |
| `/api/monitoring/maintenance/[id]`            | GET/PUT/DELETE | S    | Manage a maintenance window                |

## Push notifications

| Route                          | Methods    | Auth | Purpose                                            |
| ------------------------------ | ---------- | ---- | -------------------------------------------------- |
| `/api/push/vapid-key`          | GET        | S    | VAPID public key for the service worker subscriber |
| `/api/push/subscriptions`      | GET / POST | S    | List or register push subscriptions                |
| `/api/push/subscriptions/[id]` | DELETE     | S    | Unsubscribe a device                               |
| `/api/push/test`               | POST       | S    | Send a test notification (per-device delivery)     |
| `/api/push/diagnostics`        | GET        | S    | Push system health (subscriptions, failures)       |

## Projects

| Route                  | Methods        | Auth | Purpose                          |
| ---------------------- | -------------- | ---- | -------------------------------- |
| `/api/projects`        | GET / POST     | S    | List or create a project         |
| `/api/projects/[name]` | GET/PUT/DELETE | S    | Read / update / delete a project |

## Agent config

Editable via Settings → Agent. Backed by files in `.claude/rules/`,
`.claude/skills/`, `.claude/agents/` plus a system prompt blob.

| Route                                | Methods        | Auth | Purpose                     |
| ------------------------------------ | -------------- | ---- | --------------------------- |
| `/api/agent-config/system-prompt`    | GET / PUT      | S    | Read / update custom append |
| `/api/agent-config/rules`            | GET            | S    | List rule files             |
| `/api/agent-config/rules/[name]`     | GET/PUT/DELETE | S    | Read / save / delete a rule |
| `/api/agent-config/skills`           | GET            | S    | List skills                 |
| `/api/agent-config/skills/[name]`    | GET/PUT/DELETE | S    | Manage a skill              |
| `/api/agent-config/subagents`        | GET            | S    | List subagents              |
| `/api/agent-config/subagents/[name]` | GET/PUT/DELETE | S    | Manage a subagent           |

## Reports (scheduled Claude jobs)

| Route                            | Methods        | Auth | Purpose                       |
| -------------------------------- | -------------- | ---- | ----------------------------- |
| `/api/reports/catalog`           | GET            | S    | Available report templates    |
| `/api/reports/jobs`              | GET / POST     | S    | List / create job             |
| `/api/reports/jobs/[slug]`       | GET/PUT/DELETE | S    | Manage a job                  |
| `/api/reports/jobs/[slug]/run`   | POST           | S    | Trigger immediately           |
| `/api/reports/jobs/[slug]/runs`  | GET            | S    | Job run history               |
| `/api/reports/runs`              | GET            | S    | All runs                      |
| `/api/reports/runs/[runId]`      | GET            | S    | Run status + metadata         |
| `/api/reports/runs/[runId]/log`  | GET            | S    | Execution log (text)          |
| `/api/reports/runs/[runId]/read` | GET            | S    | Read run output file          |
| `/api/reports/runs/[runId]/stop` | POST           | S    | Stop a running report         |
| `/api/reports/validate`          | POST           | S    | Validate job YAML before save |
| `/api/reports/cron-preview`      | POST           | S    | Preview cron next-run times   |
| `/api/reports/diagnostics`       | GET            | S    | Report system health          |

## Custom OAuth integrations

Each provider follows the same shape (some skip device flow). Credentials
live on disk and are loaded into the SDK env / MCP config.

### Google (device flow + web flow)

| Route                                    | Methods   | Auth | Purpose                               |
| ---------------------------------------- | --------- | ---- | ------------------------------------- |
| `/api/google-custom/device-start`        | POST      | S    | Begin device flow (returns user code) |
| `/api/google-custom/device-poll`         | GET       | S    | Poll for device-flow token            |
| `/api/google-custom/web-authorize-start` | POST      | S    | Begin web OAuth flow                  |
| `/api/google-custom/oauth-callback`      | GET       | open | OAuth callback — validates state      |
| `/api/google-custom/authorize`           | POST      | S    | Finalize web flow                     |
| `/api/google-custom/disconnect`          | POST      | S    | Revoke + remove tokens                |
| `/api/google-custom/credentials`         | GET / PUT | S    | Manage stored client credentials      |
| `/api/google-custom/setup-script`        | GET       | S    | Setup script for the wizard           |
| `/api/google-custom/status`              | GET       | S    | Connection state                      |

### Microsoft (device flow only — Teams scopes excluded)

| Route                                | Methods   | Auth | Purpose                   |
| ------------------------------------ | --------- | ---- | ------------------------- |
| `/api/microsoft-custom/device-start` | POST      | S    | Begin device flow         |
| `/api/microsoft-custom/device-poll`  | GET       | S    | Poll for token            |
| `/api/microsoft-custom/credentials`  | GET / PUT | S    | Manage stored credentials |
| `/api/microsoft-custom/status`       | GET       | S    | Connection state          |

### GitHub / Bitbucket / Jira / Linear / Notion / Trello

Token-based (no device flow). Each exposes:

- `/api/{provider}-custom/credentials` — `GET / PUT` — manage credentials
- `/api/{provider}-custom/status` — `GET` — connection state

Full route list: `github-custom`, `bitbucket-custom`, `jira-custom`,
`linear-custom`, `notion-custom`, `trello-custom`.

### MCP auth (generic OAuth-bridge for MCP-bound integrations)

| Route                       | Methods | Auth | Purpose                            |
| --------------------------- | ------- | ---- | ---------------------------------- |
| `/api/mcp-auth/connect`     | POST    | S    | Begin OAuth for a named MCP server |
| `/api/mcp-auth/submit-code` | POST    | S    | Submit OAuth code                  |
| `/api/mcp-auth/cancel`      | POST    | S    | Cancel pending flow                |
| `/api/mcp-auth/disconnect`  | POST    | S    | Revoke + remove tokens             |

## Proxy (chat previews)

| Route               | Methods | Auth | Purpose                                                              |
| ------------------- | ------- | ---- | -------------------------------------------------------------------- |
| `/api/proxy/image`  | GET     | S    | Fetch + cache external images (10 MB cap, 7 d TTL, SSRF-guarded)     |
| `/api/proxy/unfurl` | POST    | S    | Fetch + parse + cache OG metadata (2 MB cap, 24 h TTL, SSRF-guarded) |

## STT (speech-to-text)

| Route                 | Methods   | Auth | Purpose                                  |
| --------------------- | --------- | ---- | ---------------------------------------- |
| `/api/stt/transcribe` | POST      | S    | Transcribe audio via configured provider |
| `/api/stt/settings`   | GET / PUT | S    | Get / update provider settings           |

## Infra & status

| Route                            | Methods | Auth | Purpose                                                       |
| -------------------------------- | ------- | ---- | ------------------------------------------------------------- |
| `/api/health`                    | GET     | open | Health check (consumed by docker healthcheck + load balancer) |
| `/api/status`                    | GET     | S    | Overall app status (auth, MCP, prereqs)                       |
| `/api/rate-limits`               | GET     | S    | Per-account rate-limit cache snapshot                         |
| `/api/mcp-status`                | GET     | S    | MCP servers registered + their connection state               |
| `/api/setup/install`             | POST    | S    | Run first-run setup tasks                                     |
| `/api/setup/status`              | GET     | S    | First-run setup progress                                      |
| `/api/prereqs/install-uv`        | POST    | S    | Install `uv` (used by Python-based MCP servers)               |
| `/api/prereqs/install-uv/cancel` | POST    | S    | Cancel an in-flight uv install                                |

---

## Adding a new route — checklist

1. Create `src/app/api/{path}/route.ts`, export named `GET`/`POST`/etc.
2. First line: `if (!extractSession(request)) return unauthorized();` (skip only for health-style endpoints).
3. For file paths: validate with `safePath()` from `src/lib/safe-path.ts`.
4. For state-changing routes: wrap with `withAudit(...)` from `src/lib/audit/api-wrap.ts`.
5. Add a row to this doc.
6. Test under `__tests__/route.test.ts` next to it (see `git/diff/route.test.ts` for the pattern).
