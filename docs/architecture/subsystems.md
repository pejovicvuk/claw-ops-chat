# Subsystems

One section per major subsystem: where the code lives, the entry-point file,
key types, on-disk layout, and how the runtime wires it in.

For runtime / server-level orchestration see [runtime.md](./runtime.md).
For the API surface see [api-routes.md](./api-routes.md).

---

## Audit

Append-only activity log for state-changing API calls, scheduled cron runs,
and chat session events.

**Source:** `src/lib/audit/`

| File              | Purpose                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `writer.ts`       | Singleton append-only JSONL writer (one fd per category/day)           |
| `reader.ts`       | Page through audit events; filters by category, severity, date, search |
| `api-wrap.ts`     | `withAudit({...}, handler)` middleware that wraps API route handlers   |
| `scrub.ts`        | Strip secrets / tokens / sensitive paths before writing                |
| `retention.ts`    | Delete files older than 30 days (cron — see runtime.md)                |
| `paths.ts`        | On-disk layout helpers                                                 |
| `types.ts`        | `AuditEvent` discriminated union                                       |
| `action-color.ts` | Map action → UI color                                                  |

**On-disk layout:** `/root/.audit/{api,cron,session}/YYYY-MM-DD.jsonl`,
rotated daily, purged after 30 days by the 6-hour cron.

**Categories:**

- `api/` — state-changing API calls + auth events
- `cron/` — scheduled report job + run lifecycle
- `session/` — chat session events + tool usage (metadata only)

**Producer integration points:**

- **API routes** — wrap state-changing handlers with `withAudit({ route, label, subjectFrom? }, handler)` from `@/lib/audit/api-wrap`. The wrapper logs `request_complete` / `request_error` with status code, duration, actor. For routes that short-circuit before `withAudit` can observe the outcome (e.g. login pre-auth rejections), call `logApi(request, outcome, startedAt)` directly.
- **Scheduler** — `ReportScheduler` accepts `AuditWriter` in its constructor and fires `audit.cron({...})` at register / unregister / tick / run lifecycle points.
- **`SessionManager`** (in `server.ts`) — fires `audit.session({...})` at the seven chat lifecycle points: connect, disconnect, sdk_init, user_message, tool_use_start/complete, permission_request/grant/deny, turn_complete, error. **Never logs message text or tool input values** — only metadata (length, tool name, input keys).

**Scrubbing rules** (`scrub.ts`):

- Strips secret-like keys: `authorization`, `token`, `password`, etc.
- Strips known token shapes: `Bearer …`, `sk-ant-api…`, `ghp_…`, GitHub / Slack / Google OAuth patterns.
- Strips the `/root/.claude/.credentials.json` path.
- Request bodies are never read; query strings are stripped (only pathname is persisted).
- Bash commands: keep only first 30 chars of allowlisted prefixes (`git`, `ls`, `npm`, …); non-allowlisted commands become `<redacted>`.

**Hard rule:** Never import `process.env` inside `src/lib/audit/**` — code review enforces this.

**UI:** Settings → Activity → Audit log; backed by `/api/audit/{events,events/[id],stats,export}` — see [api-routes.md#audit](./api-routes.md#audit).

---

## Push notifications

Web Push API for browser notifications when chats finish, alerts fire, etc.

**Source:** `src/lib/push/`

| File                           | Purpose                                                      |
| ------------------------------ | ------------------------------------------------------------ |
| `vapid.ts`                     | Generate a VAPID keypair                                     |
| `vapid-store.ts`               | Persist the keypair to `/root/.push/vapid.json`              |
| `send.ts`                      | Dispatch a notification to all subscribed devices            |
| `store.ts`                     | In-memory + on-disk subscription store (keyed by endpoint)   |
| `diagnostics.ts`               | Subscription health, recent delivery outcomes                |
| `types.ts`                     | `PushSubscription`, `Notification` shapes                    |
| `use-push-subscription.ts`     | Client hook — subscribe / unsubscribe                        |
| `use-sw-registration.ts`       | Client hook — register the service worker                    |
| `use-notifications-channel.ts` | Connect to `/ws/notifications` for in-tab toasts             |
| `use-push-reminder.ts`         | Prompt user to enable notifications on first chat completion |
| `use-push-diagnostics.ts`      | Fetch `/api/push/diagnostics`                                |

**Service worker:** `public/sw.js`

- Cache name `claw-chat-v4`. Bump when push handler / fetch behavior changes.
- **Install:** precache `/chat`, `/chat/login` (one failed URL ≠ abort).
- **Fetch:** network-first for nav + static; caches `_next/static` + static extensions; API + WebSocket skipped.
- **Active-chat tracking:** an IndexedDB store `activeChats` maps `client.id` → chat session id, kept fresh by `active-chat-broadcaster.tsx`.
- **Push handler:** uses `focusBehavior` flag in the payload to support `"smartChat"` (suppress notification if the user is already focused on this chat). Click → `focus()` matching tab + `navigate()` to the session.

**API:** see [api-routes.md#push-notifications](./api-routes.md#push-notifications).

---

## Monitoring

Real-time + historical observability for the host (CPU, memory, disk, Docker
containers, app logs, request latency, WebSocket clients) plus an alert
engine and an automation engine that can run remediation actions.

**Source:** `src/lib/monitoring/`

| File                   | Purpose                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `bootstrap.ts`         | Wire collectors + alert + automation + WebSocket broadcast on boot |
| `singleton.ts`         | Process-wide monitoring instance                                   |
| `collector.ts`         | Periodic collector loop                                            |
| `apm-middleware.ts`    | APM instrumentation                                                |
| `env.ts`               | Detect host capabilities (Docker, systemd, ...)                    |
| `format.ts`            | Format metrics for display                                         |
| `ring-buffer.ts`       | Circular buffer for time-series                                    |
| `timeseries-buffer.ts` | Multi-series ring buffer                                           |
| `threshold.ts`         | Threshold evaluation (healthy/warning/critical)                    |
| `scrub.ts`             | Redact sensitive monitoring data                                   |
| `ws-broadcast.ts`      | WebSocket broadcaster loop (drives `/ws/monitoring`)               |
| `ws-session-store.ts`  | Connected monitoring WebSocket clients                             |
| `types.ts`             | `MonStatus`, `MonSubsystemKey`, snapshot/series schemas            |
| `use-mon-poll.ts`      | Client hook — poll `/api/monitoring/*`                             |
| `use-mon-series.ts`    | Client hook — consume WebSocket series                             |

### Subdirectories

- **`collectors/`** — one file per subsystem: `health`, `system`, `processes`, `docker`, `cron`, `logs`, `apm`, `ws`. Each exports a poll function.
- **`alerts/`** — rule engine:
  - `engine.ts` — orchestrates evaluation
  - `evaluator.ts` — single-rule evaluation
  - `dispatcher.ts` + `webhook-channel.ts` — outbound delivery
  - `store.ts` — persist rules to disk
  - `metric-lookup.ts` + `audit-count-lookup.ts` — resolve metric paths
  - `types.ts` — `AlertRule`, `AlertEvent`
- **`automation/`** — automated remediation:
  - `engine.ts` — evaluate rules + fire actions
  - `defaults.ts` — built-in rules (force GC on threshold, trim caches, …)
  - `store.ts` — persist user rules
  - `actions/` — `force-gc-on-threshold`, `drop-fs-caches`, `restart-unhealthy-container`, `prune-docker-images`, `prune-docker-logs`, `trim-cache-dirs`, `trim-audit-retention`, `trim-heap-snapshots`, `trim-monitoring-history`, `index` (registry)
- **`maintenance/store.ts`** — maintenance window persistence (alert suppression).

**API:** see [api-routes.md#monitoring](./api-routes.md#monitoring).

**UI:** `src/components/monitoring/` — sections (`overview`, `health`,
`processes`, `docker`, `apm`, `cron`, `logs`, `ws`, `alerts`, `automation`,
`audit-live`) plus reusable primitives (`metric-card`, `gauge`, `sparkline`,
`multi-series-chart`, `data-table`, …).

---

## Reports (scheduled Claude jobs)

Cron-scheduled Claude SDK runs that produce report files. Each job has a
prompt template, a tool policy, and a schedule.

**Source:** `src/lib/reports/`

| File                                                | Purpose                                                      |
| --------------------------------------------------- | ------------------------------------------------------------ |
| `scheduler.ts`                                      | `ReportScheduler` — register / unregister / tick / run       |
| `scheduler-singleton.ts`                            | Global scheduler instance                                    |
| `session-manager-singleton.ts`                      | Global SessionManager handle (used to spin up cron sessions) |
| `runner.ts`                                         | Execute a report run end-to-end                              |
| `job-store.ts`, `job-parser.ts`, `job-validator.ts` | YAML job CRUD, parse, validate                               |
| `run-store.ts`                                      | Persist run metadata + output                                |
| `prompt-assembler.ts`                               | Build the system prompt + context for a run                  |
| `tool-catalog.ts`                                   | Allowed tool list                                            |
| `tool-policy.ts`                                    | `decideCronTool()` — allow/deny gate inside `canUseTool`     |
| `paths.ts`                                          | Disk paths for jobs and runs                                 |
| `types.ts`                                          | `ReportJob`, `ReportRun`, schedule + tool-policy schemas     |

**Lifecycle:**

1. User creates / edits a job via `/api/reports/jobs/*` (UI in `src/components/reports/`).
2. `ReportScheduler` watches the job store; on register/update, schedules a `node-cron` task.
3. On tick, `runner.ts` spins up a `ChatSession` with `cronPolicy` set, calls `query()`, and pipes events through `cronOnEvent` instead of broadcasting to WebSocket clients.
4. `tool-policy.ts:decideCronTool()` short-circuits `canUseTool` — no interactive prompts.
5. Output goes to a run file; metadata to `run-store`. UI tails via `/api/reports/runs/[runId]/log`.
6. Audit log emits `cron.register`, `cron.tick`, `cron.run_start`, `cron.run_end`.

**API:** see [api-routes.md#reports-scheduled-claude-jobs](./api-routes.md#reports-scheduled-claude-jobs).

---

## Projects

Workspaces (folder-backed) that the user can switch between. Each project
has a name + cwd; the chat layout shows a project picker in the sidebar.

**Source:** `src/lib/projects/`

| File            | Purpose                             |
| --------------- | ----------------------------------- |
| `paths.ts`      | Storage location for project config |
| `store.ts`      | Load / save / list projects         |
| `validation.ts` | Validate project name + cwd shape   |

**API:** `/api/projects` and `/api/projects/[name]` — see
[api-routes.md#projects](./api-routes.md#projects).

**UI:** `src/components/projects/` — `projects-dashboard`, `projects-main-pane`,
`projects-list`, `project-card`, `new-project-modal`, `projects-empty-state`.

---

## Proxy & previews

Inline previews for images, files, and links in assistant messages. Three
same-origin proxy routes keep the strict CSP intact (the page doesn't fetch
external content directly).

**Source:** `src/lib/proxy/`

| File                 | Purpose                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| `fetch-with-hops.ts` | Redirect-following fetch (max 3 hops); re-runs SSRF guard each hop               |
| `ssrf-guard.ts`      | `assertPublicUrl()` — rejects private IPs, non-http(s) schemes                   |
| `unfurl-cache.ts`    | OG metadata cache: `<sha256>.json`, 24 h TTL, 10 k cap                           |
| `unfurl-parser.ts`   | Parse OG / Twitter card metadata from HTML                                       |
| `image-cache.ts`     | External image cache: `<sha256>.<ext>` + `.meta.json` sidecar, 7 d TTL, 1 GB cap |

**Proxy routes:** see [api-routes.md#proxy-chat-previews](./api-routes.md#proxy-chat-previews).

**SSRF hardening (critical):** every proxy fetch goes through `assertPublicUrl()`.
Rejects private IPv4 (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16 incl. AWS
metadata, CGNAT, TEST-NETs), IPv6 loopback / ULA / link-local, and non-http(s)
schemes. `fetchWithHops` re-runs the guard on every redirect hop. Body size
capped per route (unfurl 2 MB, image 10 MB).

**Cache purge:** `cron.schedule("30 */12 * * *", ...)` in `server.ts` — see
[runtime.md#cron-jobs-registered-at-boot](./runtime.md#cron-jobs-registered-at-boot).

**Client components** (`src/components/chat/previews/`):

- `ImagePreview` — local paths via `/api/files/serve`, external via `/api/proxy/image`; click → `<Lightbox>`.
- `LinkPreview` — lazy-fetches via `useUnfurl` (in-memory + disk cache).
- `SyntaxCode` — lazy-loads shiki; bundled langs: ts/tsx/js/jsx/python/rust/go/java/bash/json/yaml/markdown/sql/html/css/diff.
- `FilePathPill` — inline chip; click opens file in editor panel via `?open=…&active=…`.
- `FileCard` — full attachment card; PDFs `<iframe>`, video/audio native, others icon + name + size + buttons.

**Markdown integration:**

- `src/components/chat/markdown-renderer.tsx` — converts assistant text → React; uses `detect-file-paths.ts` to identify lone path lines (cards) vs embedded paths (pills).
- `remark-breaks` is added so single newlines become `<br>` (so the renderer can scan list items / paragraphs for lone-path lines).
- `ToolResultBlock` specializes per `toolName`: Read on an image → `ImagePreview`, WebFetch → unfurl card + collapsed body, WebSearch → stack of mini cards, Write/Edit → `FilePathPill` + collapsed diff, others → file-path detection in raw output.

**Adding a new preview type:** wire it in `markdown-renderer.tsx` (assistant text) or add a branch in `ToolResultBlock` (tool-specific). Keep fetches same-origin — direct external `<img>` / `fetch()` is blocked by CSP.

---

## Preview streaming (dev server in canvas)

Live screencast of a user's local dev server inside a canvas window.
The chat server spins up a headless Chromium tab, points it at
`localhost:<port>`, and pipes the rendered output to the user's
browser. Three transports stack from lowest-latency to most-compatible:

| Transport     | Wire      | Latency | Phase |
| ------------- | --------- | ------- | ----- |
| **WebRTC**    | SRTP P2P  | <100 ms | 4     |
| H.264 / MSE   | WebSocket | ~300 ms | 2     |
| JPEG / canvas | WebSocket | ~500 ms | 1     |

`use-preview-stream.ts` tries WebRTC first; on any failure (5 s
connect timeout, peer-connection failed, controller capture_failed,
or `RTCPeerConnection` unavailable) it flips a sticky failure flag
and falls through to the H.264/MSE path, then JPEG/canvas as a final
fallback. Sticky flags survive reconnects so flaky links don't keep
retrying the higher-level transport.

**Source:** `src/lib/preview-stream/`

### WebRTC (Phase 4 — #130)

Architecture: chat server is signaling-only; media flows P2P via STUN.

```
Headless Chromium (controller page) ⇄ WebRTC P2P ⇄ User's browser
                ↘                  ↗
                   chat server (SDP/ICE relay)
```

- `src/app/preview-controller/page.tsx` — controller page that runs
  inside the headless tab. Iframes `/chat/preview/<port>/*` (existing
  same-origin proxy), calls `getDisplayMedia({preferCurrentTab: true})`,
  opens an `RTCPeerConnection` with a `ctrl` and `file` data channel.
- `src/lib/preview-stream/webrtc-signaling.ts` — pure pairing logic.
  30 s pair timeout, slot-collision rejection, frame relay.
- `src/lib/preview-stream/webrtc-handler.ts` — WS handler at
  `/ws/preview-rtc/<project>/<item>/<port>`. Pairs viewer + controller
  on the same `${actorEmail}|${project}|${item}|${port}` key.
- `src/lib/preview-stream/chromium-pool.ts` — `prelaunch()` seeds the
  flags needed for headless `getDisplayMedia` (`--use-fake-ui-for-media-stream`,
  `--auto-select-desktop-capture-source=Current Tab`, etc.). One-shot,
  must run before the first `acquirePage`.
- STUN servers: `stun.l.google.com:19302` (no TURN; defer to a future
  phase when a user behind asymmetric NAT actually needs it).

**Input + control routing:** when WebRTC is connected, mouse / key /
wheel / touch / paste / clipboard-copy / file-drop chunks go through
the data channels for sub-frame click latency. When MSE is active,
they go over the WebSocket. The hook's `sendJson` helper picks
transparently — call sites stay identical.

**CSP:** `next.config.ts` has a per-route override for
`/preview-controller` adding `frame-src http://localhost:* http://127.0.0.1:*`,
STUN endpoints in `connect-src`, and `Permissions-Policy: display-capture=(self)`.

### H.264 / MSE + JPEG (Phases 1–3)

Server side: `chromium-pool.ts` (singleton browser, lazy launch),
`cdp-screencast.ts` (CDP `Page.startScreencast`), `h264-encoder.ts`
(ffmpeg → fragmented MP4), `audio-capture.ts` (Phase 3a Opus mux),
`clipboard-bridge.ts` (Phase 3b two-way sync), `file-drop.ts` (Phase
3c chunked uploads), `download-relay.ts` (Phase 3d).

Client side: `use-preview-stream.ts` capability-detects MSE; on
`SourceBuffer.error` or `appendBuffer` failure, sticky-flips to JPEG.

---

## Git

Repository operations exposed to the UI. **Read-only** — writes happen via
Claude tools or the host shell, not these endpoints.

**Source:** `src/lib/git/`

| File               | Purpose                                         |
| ------------------ | ----------------------------------------------- |
| `exec.ts`          | Run git via `child_process` and capture output  |
| `parse-status.ts`  | Parse `git status --porcelain` into `GitFile[]` |
| `derive-status.ts` | Map status codes (`M`, `??`, `A`, `D`) → labels |
| `types.ts`         | `GitFile`, `GitStatus`                          |

**API:** see [api-routes.md#git](./api-routes.md#git).

**UI:** `src/components/chat/file-browser/git/` — `git-panel-view`,
`branch-list*`, `branch-checkout-confirm`, `commit-list*`, `commit-diff-panel`.

---

## File system

Path safety + listing + uploads — used by the file browser and any feature
that needs to read or write user files.

**Source files in `src/lib/`:**

- `safe-path.ts` — `safePath()` (validates against base dir + symlinks), `safeFilename()` (strips path components from uploaded names)
- `resolve-path.ts` — resolve `~` and relative paths
- `detect-file-paths.ts` — regex extractor for assistant text (gated on a path separator: `/`, `~/`, `./`)
- `file-cache.ts` — read cache
- `download-xhr.ts`, `upload-xhr.ts`, `batch-upload.ts` — progress-aware transports
- `mime.ts` — MIME inference
- `search-excludes.ts` — `.gitignore`-style ignore parser

**API:** see [api-routes.md#files](./api-routes.md#files).

**Hard rule:** every API route accepting a path from user input MUST call
`safePath()` before touching the FS. `path.join` / `path.resolve` directly on
user input is forbidden — see `.claude/rules/security.md`.

---

## Auth (server side)

**Source:** `src/lib/auth-server.ts`, `src/lib/auth.ts` (client),
`src/lib/api-backend.ts`, `src/lib/apiClient.ts`,
`src/lib/ws-ticket-store.ts`.

**Model:** single-user, gated by `ALLOWED_EMAIL`. Login flow:

1. Browser POSTs credentials to the Spring backend (`api-backend.ts:loginApi()`).
2. Backend returns JWT + refresh token; stored in localStorage by `auth.ts`.
3. Client POSTs to `/api/auth/session` to mint an HMAC-signed cookie.
4. `auth-server.ts:extractSession(request)` validates the cookie on every API call (timing-safe).

**Cookie flags:** HttpOnly, SameSite=Strict, Path=/chat, Secure in prod.

**WebSocket auth:** since the cookie is HttpOnly, the browser cannot read it
to put in the WebSocket URL. Workaround: `/api/auth/ws-ticket` mints a
single-use UUID, valid ~30 s, consumed by `ws-ticket-store.ts:consumeWsTicket()`.

**Secrets:** `SESSION_SECRET` env (auto-generated if absent — acceptable for
single-instance). Never logged, never in audit events (scrubbed).

---

## Where to read next

- **API surface:** [api-routes.md](./api-routes.md)
- **`server.ts` deep dive:** [runtime.md](./runtime.md)
- **External services:** [integrations.md](./integrations.md)
