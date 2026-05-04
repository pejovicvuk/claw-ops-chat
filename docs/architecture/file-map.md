# File Map

Every directory and file in the repo, with one-line purpose. For API routes,
see [api-routes.md](./api-routes.md). For deep dives on `server.ts` and
subsystems, see [runtime.md](./runtime.md) and [subsystems.md](./subsystems.md).

> Compiled `.js` files next to `.ts` sources (e.g. `src/lib/audit/writer.js`
> next to `writer.ts`) are `tsc` build artifacts — not separate sources. They
> ship in the production image and are gitignored locally.

## Repo root

| Path                 | Purpose                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `server.ts`          | Custom Node.js HTTP + WebSocket server, Claude Agent SDK glue, session mgr  |
| `server.js`          | Compiled output of `server.ts` (npm run build → `tsc server.ts`)            |
| `bitbucket-mcp.ts`   | Stdio MCP server exposing 16 read-only Bitbucket tools                      |
| `bitbucket-mcp.js`   | Compiled output of `bitbucket-mcp.ts`                                       |
| `sdk-loader.js`      | CJS-only require shim for `@anthropic-ai/claude-agent-sdk` (avoid esbuild)  |
| `next.config.ts`     | Next.js: `basePath=/chat`, standalone output, CSP headers, server externals |
| `tsconfig.json`      | Strict TS, `@/*` → `src/*` path alias                                       |
| `eslint.config.mjs`  | ESLint 9 flat config (eslint-config-next + prettier)                        |
| `vitest.config.ts`   | Vitest 4 — `NODE_ENV=test`, `@/` alias for tests                            |
| `postcss.config.mjs` | Tailwind 4 PostCSS plugin                                                   |
| `.prettierrc`        | Semi, double-quote, trailing-comma=all, printWidth=100                      |
| `package.json`       | Scripts (dev/build/start/test/lint/format), deps                            |
| `Dockerfile`         | Multi-stage: deps → builder → runner (node:24-alpine + uv/jq/gh/git)        |
| `docker-compose.yml` | Production deploy: bind mounts, `/proc`/`/sys` for systeminformation        |
| `.env.example`       | Env var surface (see root `CLAUDE.md` for the list)                         |
| `next-env.d.ts`      | Auto-generated Next.js types                                                |
| `package-lock.json`  | Lockfile                                                                    |
| `CLAUDE.md`          | Conventions, commands, security checklist (auto-loaded)                     |
| `README.md`          | (Not present — root has no public README)                                   |

## `src/app/` — Next.js App Router

Pages, layouts, providers. API routes live under `src/app/api/` and are
documented separately in [api-routes.md](./api-routes.md).

| Path             | Purpose                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `layout.tsx`     | Root layout, manifest, icons, sets `window.__CLAWCHAT_API_ORIGIN__`  |
| `page.tsx`       | Main chat page (`ChatPage`) — auth-gated, hosts chat layout          |
| `providers.tsx`  | `ThemeProvider`, `ServiceWorkerBoot`, `NotificationListener`, toasts |
| `globals.css`    | Tailwind base + CSS custom properties (`--accent`, `--canvas-bg`, …) |
| `favicon.ico`    | Browser favicon                                                      |
| `login/page.tsx` | Login form; auto-restore via stored refresh token, then `loginApi()` |

## `src/components/` — React UI

### Top-level

| Path                 | Purpose                      |
| -------------------- | ---------------------------- |
| `app-skeleton.tsx`   | App-wide loading skeleton    |
| `error-boundary.tsx` | React error fallback wrapper |

### `chat/` — chat surface

| Path                             | Purpose                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| `chat-layout.tsx`                | Main 3-pane layout: sidebar, file browser, editor, chat         |
| `chat-view.tsx`                  | Message list renderer                                           |
| `chat-input.tsx`                 | Input box (mentions, attachments, voice)                        |
| `chat-input/attachment-pill.tsx` | Attachment chip                                                 |
| `chat-input/attachment-row.tsx`  | Attachment row container                                        |
| `chat-input/mention-popover.tsx` | `@mention` autocomplete                                         |
| `chat-input/voice-recorder.tsx`  | Voice recording UI                                              |
| `chat-input/voice-wave.tsx`      | Audio waveform animation                                        |
| `markdown-renderer.tsx`          | Markdown → JSX, file-card/pill detection, syntax highlight glue |
| `message-bubble.tsx`             | User/assistant message rendering                                |
| `empty-state.tsx`                | "Start a new conversation" placeholder                          |
| `context-indicator.tsx`          | Shows files in current context                                  |
| `status-indicator.tsx`           | Connection / session status dot                                 |
| `hud-indicator.tsx`              | HUD overlay (tools running)                                     |
| `hud-popup.tsx`                  | Tool execution popover                                          |
| `push-reminder-banner.tsx`       | Notification opt-in banner                                      |
| `session-list.tsx`               | Sidebar session list (rename/delete)                            |
| `setup-guard.tsx`                | Blocks chat until first-run setup complete                      |
| `mobile-file-sheet.tsx`          | Mobile-friendly file browser drawer                             |
| `file-browser.tsx`               | (Compatibility shim — actual UI in `file-browser/`)             |
| `file-editor-panel.tsx`          | (Compatibility shim — actual UI in `file-editor/`)              |

### `chat/file-browser/` — file explorer

| Path                                          | Purpose                                 |
| --------------------------------------------- | --------------------------------------- |
| `breadcrumbs.tsx`                             | Path breadcrumbs                        |
| `file-row.tsx`                                | Single file/folder row                  |
| `file-icon.tsx`                               | MIME-type → icon                        |
| `file-toolbar.tsx`                            | New / upload / delete / refresh actions |
| `file-dropzone.tsx`                           | Drag-drop upload                        |
| `delete-confirm.tsx`                          | Delete confirmation dialog              |
| `new-item-dialog.tsx`                         | Create file/folder dialog               |
| `git/git-panel-view.tsx`                      | Git side panel                          |
| `git/branch-list.tsx`, `branch-list-item.tsx` | Branch selector                         |
| `git/branch-checkout-confirm.tsx`             | Switch-branch confirmation              |
| `git/commit-list.tsx`, `commit-list-item.tsx` | Commit history                          |
| `git/commit-diff-panel.tsx`                   | Per-commit diff viewer                  |

### `chat/file-editor/` — code editor

| Path                     | Purpose                               |
| ------------------------ | ------------------------------------- |
| `editor-panel.tsx`       | Tabbed multi-file editor host         |
| `editor-tabs.tsx`        | File tabs                             |
| `header.tsx`             | Editor header (path, dirty/read-only) |
| `code-mirror.tsx`        | CodeMirror 6 editor                   |
| `diff-view.tsx`          | Side-by-side / unified diff           |
| `binary-placeholder.tsx` | Fallback for binary files             |
| `readable-preview.tsx`   | Image/PDF/etc preview mode            |
| `download-progress.tsx`  | Download progress bar                 |
| `language-for-path.ts`   | Path → CodeMirror language id         |
| `layout-store.ts`        | Zustand store for editor pane sizing  |

### `chat/previews/` — inline content

| Path                 | Purpose                                    |
| -------------------- | ------------------------------------------ |
| `link-preview.tsx`   | Unfurled OG card via `useUnfurl`           |
| `image-preview.tsx`  | Inline image; click → `<Lightbox>`         |
| `file-card.tsx`      | Full-size file attachment card             |
| `file-path-pill.tsx` | Compact path chip with portal context menu |
| `syntax-code.tsx`    | Lazy-loaded shiki code block + copy button |
| `lightbox.tsx`       | Full-screen image viewer modal             |

### `auth/`

| Path             | Purpose                                         |
| ---------------- | ----------------------------------------------- |
| `auth-guard.tsx` | Redirects to `/chat/login` if not authenticated |

### `audit/`

| Path                      | Purpose                                     |
| ------------------------- | ------------------------------------------- |
| `audit-table.tsx`         | Paginated event table                       |
| `audit-row.tsx`           | Single audit row                            |
| `audit-filter-bar.tsx`    | Category / severity / date / search filters |
| `audit-detail-drawer.tsx` | Event detail (full payload)                 |
| `scoped-audit-drawer.tsx` | Audit scoped to a session/route             |
| `audit-stats.tsx`         | Counts by category/severity                 |
| `bulk-delete-dialog.tsx`  | Bulk-delete confirmation                    |

### `monitoring/`

| Path                           | Purpose                                               |
| ------------------------------ | ----------------------------------------------------- |
| `monitoring-sidebar.tsx`       | Monitoring nav (Health, System, Processes, Docker, …) |
| `monitoring-toolbar.tsx`       | Refresh / filter / export toolbar                     |
| `monitoring-context.tsx`       | Shared monitoring React context                       |
| `settings-monitoring-page.tsx` | Monitoring settings (alerts, automation)              |

`monitoring/primitives/` — reusable building blocks: `metric-card`, `metric-bar`,
`gauge`, `sparkline`, `multi-series-chart`, `status-badge`, `status-dot`,
`threshold-bar`, `data-table`, `detail-drawer`, `section-grid`, `empty-state`,
`collapsible-block`, `confirm-action-dialog`.

`monitoring/sections/` — full dashboard sections: `overview-section`,
`health-section`, `system-section`, `processes-section`, `docker-section`,
`docker-container-drawer`, `apm-section`, `cron-section`, `logs-section`,
`ws-section`, `alerts-section`, `alert-rule-editor`, `automation-section`,
`automation-rule-editor`, `audit-live-section`.

### `notifications/`

| Path                          | Purpose                                     |
| ----------------------------- | ------------------------------------------- |
| `notification-listener.tsx`   | Subscribes to `/ws/notifications`           |
| `active-chat-broadcaster.tsx` | Broadcasts active chat id across tabs (IDB) |

### `projects/`

| Path                       | Purpose                      |
| -------------------------- | ---------------------------- |
| `projects-dashboard.tsx`   | Main projects view           |
| `projects-main-pane.tsx`   | Project detail panel         |
| `projects-list.tsx`        | Project list                 |
| `project-card.tsx`         | Single project card          |
| `projects-empty-state.tsx` | Empty state                  |
| `new-project-modal.tsx`    | Create / edit project dialog |

### `reports/`

| Path                      | Purpose                         |
| ------------------------- | ------------------------------- |
| `reports-dashboard.tsx`   | Main reports view               |
| `reports-main-pane.tsx`   | Report / run detail             |
| `reports-list.tsx`        | Job list                        |
| `job-card.tsx`            | Job summary card                |
| `job-editor.tsx`          | YAML job editor with validation |
| `report-viewer.tsx`       | Final output viewer             |
| `live-run-viewer.tsx`     | Live execution log stream       |
| `reports-empty-state.tsx` | Empty state                     |

### `settings/`

| Path                        | Purpose                                          |
| --------------------------- | ------------------------------------------------ |
| `settings-overlay.tsx`      | Modal settings drawer                            |
| `settings-section.tsx`      | Collapsible section primitive                    |
| `connection-row.tsx`        | OAuth status + connect/disconnect                |
| `theme-selector.tsx`        | Dark/light/system picker                         |
| `markdown-file-editor.tsx`  | Generic markdown editor for `.claude/rules` etc. |
| `google-setup-terminal.tsx` | Terminal-style Google OAuth setup output         |
| `pages/`                    | One file per settings page (see below)           |

`settings/pages/` — `settings-main-page`, `settings-claude-page`,
`settings-agent-page`, `settings-agent-rules-page`, `settings-agent-skills-page`,
`settings-agent-subagents-page`, `settings-agent-system-prompt-page`,
`settings-connections-page`, `settings-github-page`, `settings-google-page`,
`google-custom-wizard`, `settings-microsoft-page`, `settings-jira-page`,
`settings-linear-page`, `settings-bitbucket-page`, `settings-notion-page`,
`settings-trello-page`, `settings-slack-page`, `settings-terminal-page`,
`settings-voice-page`, `settings-notifications-page`.

### `sidebar/`

| Path               | Purpose                                      |
| ------------------ | -------------------------------------------- |
| `sidebar.tsx`      | Left nav rail                                |
| `sidebar-tabs.tsx` | Tab switcher (Chat / Projects / Reports / …) |

## `src/lib/` — utilities & business logic

### Top-level files

Auth & session

- `auth.ts` — client-side auth state (refresh token, user) in localStorage
- `auth-server.ts` — HMAC-signed cookie sign/verify, `extractSession()`, `unauthorized()`
- `api-backend.ts` — Spring backend client (`loginApi`, `refreshTokenApi`)
- `apiClient.ts` — fetch wrapper, JWT auto-refresh
- `api.ts` — local API helpers (`fetchSessions`, `deleteSession`, `fetchAudit`, …)
- `ws-ticket-store.ts` — short-lived WebSocket auth tickets (UUID, in-memory)

Sessions

- `use-claude-chat.ts` — main React hook owning the chat WebSocket connection
- `session-persistence.ts` — disk persistence for session status/event history
- `session-cache.ts` — in-memory session cache (stale-while-revalidate)
- `session-status-store.ts` — shared status store for sidebar live updates
- `session-cwd-context.tsx` — React context for current working directory
- `session-branches.ts` — git branch info per session
- `chat-files-context.tsx` — React context for files attached to a chat

Files & paths

- `safe-path.ts` — path traversal prevention (`safePath`, `safeFilename`)
- `resolve-path.ts` — resolve symlinks + relative paths
- `detect-file-paths.ts` — regex extractor for file paths in assistant text
- `file-cache.ts` — cache file read results
- `download-xhr.ts` / `upload-xhr.ts` / `batch-upload.ts` — XHR uploaders/downloaders with progress
- `mime.ts` — MIME helpers
- `search-excludes.ts` — `.gitignore`-style pattern parser

Git

- `git-api.ts` — high-level git operations
- `use-git-status.ts`, `use-git-log.ts`, `use-git-diff.ts`, `use-git-branches.ts`, `use-commit-diff.ts` — React hooks for `/api/git/*`

Rate limits & status

- `account-rate-limits.ts` — per-account rate limit cache
- `rate-limit-probe.ts` — boot-time probe of backend rate limits
- `claude-status.ts` — detect Claude IDE availability
- `claude-auth-state.ts`, `claude-auth-sessions.ts`, `claude-auth-subprocess.ts`, `claude-auth-direct-oauth.ts` — Claude IDE auth flows
- `prereq-sessions.ts` — track prerequisite installs (uv, …)

MCP & integrations

- `mcp-register.ts` — register MCP servers in `~/.claude.json`
- `mcp-auth-sessions.ts` — OAuth sessions for MCP servers
- `agent-config.ts` — load/save agent system prompt + rules + skills
- Integration configs: `google-custom-config.ts`, `google-custom-oauth-state.ts`, `google-custom-scopes.ts`, `google-workspace-mcp-tokens.ts`, `github-custom-config.ts`, `microsoft-custom-config.ts`, `microsoft-custom-scopes.ts`, `bitbucket-custom-config.ts`, `jira-custom-config.ts`, `linear-custom-config.ts`, `notion-custom-config.ts`, `trello-custom-config.ts`

STT

- `stt-providers.ts` — provider registry
- `stt-custom-config.ts` — provider configuration
- `stt-defaults.ts` — defaults

Domain types & helpers

- `types.ts` — shared types: `ChatMessage`, `ChatSession`, `FileEntry`, …
- `model-pricing.ts` — Claude per-model token costs
- `nav-urls.ts` — URL builders for chat/session/file routes
- `cron-humanize.ts` — cron expression → English
- `format-time.ts`, `format-relative-time.ts` — timestamp formatters
- `fuzzy-score.ts` — fuzzy match scoring
- `terminal-shell.ts`, `platform-detect.ts` — environment detection

Hooks (UI)

- `use-toast.tsx`, `use-lightbox.tsx` — context providers + hooks
- `use-is-mobile.ts`, `use-visual-viewport.ts`, `use-long-press.ts` — viewport / gesture
- `use-mentions.ts`, `use-composer-attachments.ts` — composer state
- `use-url-state.ts` — URL query param state
- `use-workspace-index.ts` — workspace file index
- `use-resolve-path.ts`, `use-file-listings.ts`, `use-file-stat.ts` — file ops
- `use-session-branches.ts`, `use-session-statuses.ts` — session metadata
- `use-unfurl.ts` — link unfurl
- `use-download.ts`, `use-exit-animation.ts` — UX
- `use-projects.ts`, `use-reports.ts`, `use-audit.ts` — feature lists
- `clamp-to-viewport.ts`, `z-index.ts` — UI utilities

### `src/lib/audit/`

`writer.ts`, `reader.ts`, `api-wrap.ts`, `scrub.ts`, `retention.ts`, `paths.ts`,
`types.ts`, `action-color.ts`. See [subsystems.md#audit](./subsystems.md#audit).

### `src/lib/push/`

`vapid.ts`, `vapid-store.ts`, `send.ts`, `store.ts`, `diagnostics.ts`,
`types.ts`, plus React hooks: `use-push-subscription`, `use-sw-registration`,
`use-notifications-channel`, `use-push-reminder`, `use-push-diagnostics`. See
[subsystems.md#push-notifications](./subsystems.md#push-notifications).

### `src/lib/git/`

`exec.ts` (run git), `parse-status.ts` (porcelain parser), `derive-status.ts`
(file-state classifier), `types.ts`.

### `src/lib/monitoring/`

Top-level: `bootstrap`, `singleton`, `collector`, `apm-middleware`, `env`,
`format`, `ring-buffer`, `timeseries-buffer`, `threshold`, `scrub`,
`ws-broadcast`, `ws-session-store`, `types`, `use-mon-poll`, `use-mon-series`.

- `collectors/` — `health`, `system`, `processes`, `docker`, `cron`, `logs`, `apm`, `ws`
- `alerts/` — `engine`, `evaluator`, `dispatcher`, `webhook-channel`, `store`, `metric-lookup`, `audit-count-lookup`, `types`
- `automation/` — `engine`, `defaults`, `store`, `types`, plus `actions/` (`force-gc-on-threshold`, `drop-fs-caches`, `restart-unhealthy-container`, `prune-docker-images`, `prune-docker-logs`, `trim-cache-dirs`, `trim-audit-retention`, `trim-heap-snapshots`, `trim-monitoring-history`, `index`)
- `maintenance/store.ts` — maintenance window persistence

### `src/lib/proxy/`

`fetch-with-hops.ts`, `ssrf-guard.ts`, `unfurl-cache.ts`, `unfurl-parser.ts`,
`image-cache.ts`. See [subsystems.md#proxy--previews](./subsystems.md#proxy--previews).

### `src/lib/projects/`

`paths.ts`, `store.ts`, `validation.ts` — `.claude/projects/` storage layout.

### `src/lib/reports/`

`scheduler.ts`, `scheduler-singleton.ts`, `session-manager-singleton.ts`,
`runner.ts`, `job-store.ts`, `job-parser.ts`, `job-validator.ts`,
`run-store.ts`, `prompt-assembler.ts`, `tool-catalog.ts`, `tool-policy.ts`,
`paths.ts`, `types.ts`.

### `src/lib/file-preview/`

`pick-renderer.ts` — pick the right preview renderer (PDF/image/code/binary)
based on MIME and size.

### `src/lib/preview-stream/`

Headless-Chromium screencast pipeline for the canvas "preview window"
feature. Three-transport stack (WebRTC > H.264/MSE > JPEG/canvas) plus
clipboard / file-drop / download bridges. See
[preview-stream.md](./preview-stream.md) for the full walkthrough.

- `handler.ts` — WS handler at `/ws/preview-stream/<slug>/<item>/<port>`
- `chromium-pool.ts` — singleton headless Chromium with 5-min idle shutdown
- `cdp-screencast.ts` — CDP `Page.startScreencast` wrapper
- `h264-encoder.ts` — ffmpeg → fragmented-MP4 init/media segments
- `audio-capture.ts` — Phase 3a: parec → Opus mux into the H.264 stream
- `png-decoder.ts` — inline PNG → RGB24 for ffmpeg stdin
- `input-forward.ts` — mouse / wheel / key / touch / resize → CDP `Input.*`
- `clipboard-bridge.ts` — Phase 3b: two-way clipboard sync
- `file-drop.ts` — Phase 3c: chunked uploads injected via Playwright binding
- `download-relay.ts` — Phase 3d: `<a download>` → `/api/preview-download/<id>`
- `history-state.ts` — Phase 5a: emits `history_state` on framenavigated
- `find-in-page.ts` — Phase 5c: injects `__clawFind` controller
- `zoom-steps.ts` — Phase 5b: client-side zoom clamp helper
- `webrtc-handler.ts` — Phase 4 (#130): `/ws/preview-rtc` viewer + controller pairing
- `webrtc-signaling.ts` — pure pairing logic + slot-collision rules
- `webrtc-config.ts` — STUN/TURN config, env-driven
- `webrtc-metrics.ts` — in-memory counters for `/api/preview/metrics`
- `health.ts` + `health.test.ts` — Phase 6a (#134): registry + cap + heartbeat + audit
- `use-preview-stream.ts` — client React hook: WS open, MSE buffer, fallback
- `__tests__/` — additional integration tests

## `public/` — PWA assets

| Path                          | Purpose                                     |
| ----------------------------- | ------------------------------------------- |
| `manifest.json`               | PWA Web App Manifest (name, icons, scope)   |
| `sw.js`                       | Service worker — caching, push, active-chat |
| `icons/icon-192.png`          | 192×192 icon                                |
| `icons/icon-512.png`          | 512×512 icon                                |
| `icons/icon-maskable-512.png` | Maskable variant                            |
| `icons/apple-touch-icon.png`  | iOS home-screen icon                        |

## `skills/bitbucket/` — read-only Bitbucket CLI

| Path               | Purpose                                                   |
| ------------------ | --------------------------------------------------------- |
| `bitbucket-cli.sh` | Bash wrapper around Bitbucket Cloud REST + curl + python3 |
| `SKILL.md`         | Skill description (read-only operations only)             |

The `bitbucket-mcp.ts` stdio MCP server at the repo root spawns this script.

## `.claude/` — Claude Code harness config

| Path                        | Purpose                                                  |
| --------------------------- | -------------------------------------------------------- |
| `settings.json`             | Permissions allow/deny + hooks (auto-format, protect, …) |
| `settings.local.json`       | Local-only permissions (e.g. port 3100 kill)             |
| `agents/code-reviewer.md`   | Code-reviewer subagent definition                        |
| `agents/researcher.md`      | Read-only researcher subagent (haiku)                    |
| `rules/api-routes.md`       | API route conventions (auth, response shape, safePath)   |
| `rules/code-style.md`       | TS / React / Tailwind style rules                        |
| `rules/security.md`         | Auth, path traversal, CSP, secrets                       |
| `rules/testing.md`          | Vitest patterns                                          |
| `skills/deploy/SKILL.md`    | "Build and deploy via Docker" skill                      |
| `skills/fix-issue/SKILL.md` | "Fix a GitHub issue" skill                               |
| `skills/review/SKILL.md`    | "Review code on a PR" skill                              |
| `hooks/auto-format.sh`      | Post-Edit/Write — runs prettier                          |
| `hooks/auto-lint.sh`        | Post-Edit/Write — runs eslint                            |
| `hooks/protect-files.sh`    | Pre-Edit/Write — blocks edits to protected paths         |
| `hooks/stop-verify.sh`      | Stop event — verification hook                           |
| `CLAUDE.md`                 | Session bootstrap (this doc set's index)                 |

## `prod-example/`

Reference deployment files (env, compose) — not consumed by the build.

## `docs/architecture/` (this directory)

| Path              | Purpose                                     |
| ----------------- | ------------------------------------------- |
| `README.md`       | Index + task-to-doc grid                    |
| `file-map.md`     | This file                                   |
| `api-routes.md`   | Every API route                             |
| `runtime.md`      | `server.ts` deep dive                       |
| `subsystems.md`   | Audit / push / monitoring / reports / proxy |
| `integrations.md` | Spring / SDK / MCP / OAuth / STT / Web Push |

## Tests (47 files)

Test files are co-located with sources (`foo.test.ts` next to `foo.ts`).
Notable test areas:

- Auth / paths: `safe-path`, `resolve-path`, `auth-server`
- Audit: `writer`, `retention`, `scrub`, `action-color`
- Monitoring: `ring-buffer`, `timeseries-buffer`, `scrub`, `alerts/evaluator`
- Push: `send`, `store`, `vapid-store`, `diagnostics`
- Reports: `job-parser`, `job-validator`, `run-store`, `prompt-assembler`, `tool-policy`
- Proxy: `ssrf-guard`, `unfurl-parser`
- Projects: `store`, `validation`
- Git: `parse-status`, `derive-status`
- Misc: `model-pricing`, `nav-urls`, `cron-humanize`, `detect-file-paths`, `format-relative-time`, `fuzzy-score`, `mcp-register`, `account-rate-limits`, `rate-limit-probe`, `agent-config`, `google-custom-config`, `stt-custom-config`, `session-status-store`, `sdk-query`, `file-preview/pick-renderer`
- React hooks: `use-git-diff`, `use-commit-diff`, `use-exit-animation`
- API routes: `git/diff`, `git/commit-diff`, `sessions/branches`
- Components: `chat/markdown-renderer`, `chat/file-browser.click-swap`, `lib/chat-files-context`
