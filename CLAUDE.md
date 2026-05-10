# Claw Chat — Claude Code Project Guide

## Quick Reference

| Action             | Command                                                       |
| ------------------ | ------------------------------------------------------------- |
| Install            | `npm install`                                                 |
| Dev                | `npm run dev` (tsx server.ts — HTTP + WebSocket on port 3100) |
| Dev (Next.js only) | `npm run dev:next`                                            |
| Build              | `npm run build` (next build + tsc server.ts)                  |
| Start              | `npm start` (node server.js)                                  |
| Test               | `npm test` (vitest run)                                       |
| Test watch         | `npm run test:watch`                                          |
| Single test        | `npx vitest run src/lib/safe-path.test.ts`                    |
| Lint               | `npm run lint` (eslint)                                       |
| Format             | `npm run format` (prettier --write .)                         |
| Format check       | `npm run format:check`                                        |
| Type check         | `npx tsc --noEmit`                                            |
| Docker build       | `docker compose build`                                        |
| Docker deploy      | `docker compose up -d`                                        |
| Health check       | `curl http://localhost:3100/chat/api/health`                  |

## Architecture

Web chat interface for Claude Agent SDK sessions. A custom Node.js server
handles HTTP (Next.js) and WebSocket (Claude streaming) on a single port.

### Key Files

| File                         | Purpose                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `server.ts`                  | HTTP + WebSocket server, Claude Agent SDK integration              |
| `src/app/page.tsx`           | Main chat page (client component, protected by AuthGuard)          |
| `src/app/layout.tsx`         | Root layout, CSP headers, PWA manifest                             |
| `src/app/login/page.tsx`     | Login page                                                         |
| `src/app/api/`               | Next.js API routes (auth, sessions, files, health)                 |
| `src/components/chat/`       | Chat UI: layout, view, input, messages, file browser               |
| `src/components/auth/`       | AuthGuard route protection                                         |
| `src/lib/auth-server.ts`     | HMAC-signed session cookies, extractSession(), unauthorized()      |
| `src/lib/safe-path.ts`       | Path traversal prevention (safePath(), safeFilename())             |
| `src/lib/use-claude-chat.ts` | WebSocket hook for Claude streaming                                |
| `src/lib/api.ts`             | Client-side local API helpers                                      |
| `src/lib/api-backend.ts`     | Spring backend API client                                          |
| `src/lib/apiClient.ts`       | JWT token management, auto-refresh                                 |
| `src/lib/types.ts`           | Shared TypeScript interfaces                                       |
| `src/lib/audit/`             | Audit log writer, reader, retention, scrubbing (see section below) |
| `src/lib/memory/`            | Cross-session memory: global injector + SDK auto-memory glue       |
| `next.config.ts`             | basePath=/chat, standalone output, CSP headers                     |
| `Dockerfile`                 | Multi-stage build (deps -> builder -> runner on node:24-alpine)    |
| `docker-compose.yml`         | Production deployment with volume mounts                           |
| `skills/bitbucket/`          | Read-only Bitbucket CLI; driven by the `bitbucket-mcp.ts` wrapper  |
| `bitbucket-mcp.ts`           | Stdio MCP server that exposes `bitbucket_*` tools to Claude        |

### URL Structure

All routes are under `/chat` base path:

- `/chat/` — Main chat interface
- `/chat/login` — Login page
- `/chat/api/health` — Health check
- `/chat/api/auth/session` — POST (establish) / DELETE (logout)
- `/chat/api/sessions` — List Claude Code sessions
- `/chat/api/sessions/[id]/messages` — Session message history
- `/chat/api/files/*` — File operations (list, read, write, upload, download, delete)
- WebSocket: `/ws/chat` — Claude streaming

## Code Conventions

### TypeScript

- Strict mode enabled. Never use `any` — use `unknown` and narrow.
- Use `@/*` path alias for `src/*` imports.
- `async/await` everywhere, never raw `.then()` chains.
- Prefer `const`; never use `var`.

### React

- Functional components only with `"use client"` directive where needed.
- `useCallback` for event handlers passed as props.
- Props interfaces named `{ComponentName}Props`.
- Tailwind CSS 4 utility-first styling.

### Naming

- Files: `kebab-case.tsx` (e.g., `chat-input.tsx`)
- Components: `PascalCase` (e.g., `ChatInput`)
- Hooks: `use-` prefix file, `use` prefix function (e.g., `use-claude-chat.ts` → `useClaudeChat`)
- Types: `PascalCase` (e.g., `ChatMessage`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `SESSION_MAX_AGE`)

### Error Handling

- Try/catch with empty catch `{}` for non-critical failures (localStorage, etc.)
- API routes return `{ error: string }` with appropriate HTTP status.
- Never expose internal paths or stack traces to clients.

## Git Workflow

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
- Feature branches off main: `feature/<desc>`, `fix/<desc>`, `chore/<desc>`
- Never push directly to main — always use PRs.
- Never force push.
- Run `npm test && npm run lint` before committing.

## Environment Variables

See `.env.example` for full list. Key variables:

- `NEXT_PUBLIC_API_ORIGIN` — Spring backend URL (scheme + host)
- `ALLOWED_EMAIL` — Single authorized user email
- `PORT` — Server port (default: 3100)
- `SESSION_SECRET` — HMAC key for cookies (auto-generated if absent)
- `CLAUDE_CWD` — Working directory for Claude agent (default: /root)
- `ALLOWED_ORIGINS` — Comma-separated WebSocket origins

Never commit `.env` files.

## Audit log

Server-side append-only activity log under `/root/.audit/` (persisted via
the existing `/root:/root` docker-compose volume). Three categories of
JSONL files rotate daily and auto-purge after 30 days:

- `api/YYYY-MM-DD.jsonl` — state-changing API calls and auth events
- `cron/YYYY-MM-DD.jsonl` — scheduled report job + run lifecycle
- `session/YYYY-MM-DD.jsonl` — Claude chat session events + tool usage

The UI lives at **Settings → Activity → Audit log** and is backed by
`/api/audit/{events,events/[id],stats,export}`.

### Producer integration points

- API routes (state-changing): wrap with `withAudit({ route, label, subjectFrom? }, handler)`
  from `@/lib/audit/api-wrap`. The wrapper logs `request_complete` /
  `request_error` with status code, duration, and actor. For routes that
  short-circuit before `withAudit` can observe the outcome (e.g. login
  pre-auth rejections), call `logApi(request, outcome, startedAt)` directly.
- Scheduler: `ReportScheduler` accepts `AuditWriter` in its constructor and
  fires `audit.cron({...})` at register/unregister/tick/run lifecycle points.
- SessionManager (`server.ts`): fires `audit.session({...})` at the seven
  chat lifecycle points (connect, disconnect, sdk_init, user_message,
  tool_use_start/complete, permission_request/grant/deny, turn_complete,
  error). Never logs message text or tool input values — only metadata
  (length, tool name, input keys).

### What's scrubbed

`scrubDetails` strips secret-like keys (authorization, token, password,
etc.), known token shapes (`Bearer …`, `sk-ant-api…`, `ghp_…`, GitHub /
Slack / Google OAuth patterns), and the `/root/.claude/.credentials.json`
path. Request bodies are never read; query strings are stripped (only
pathname is persisted). Bash commands only keep the first 30 chars of
allowlisted prefixes (`git`, `ls`, `npm`, …); non-allowlisted commands
become `<redacted>`. **Never import `process.env` inside
`src/lib/audit/**`\*\* — this is enforced by code review.

### Retention

`src/lib/audit/retention.ts` purges daily files older than 30 days. Run
once at boot and every 6 hours thereafter via node-cron (scheduled in
`server.ts`). Manual purge available from the UI (bulk by `olderThan`
timestamp + optional category filter).

## Memory

Cross-session knowledge. Three flavours, all in one Settings page.

- **Global memory** — `/root/.memory/global/<file>.md` (override base with
  `MEMORY_ROOT`). Concatenated into the system-prompt append on every
  turn by `getGlobalMemoryAppend()` in `src/lib/memory/global-injector.ts`.
  As of Phase 2, this also absorbs the legacy "Agent → System prompt" and
  "Agent → Rules" content (migrated at boot to `instructions.md` and
  `rules/<name>.md` under the same root).
- **Auto-collected memory** — `/root/.memory/global/auto.md`. A single
  file, ~5 KB cap, populated by a post-session Haiku consolidator
  (`src/lib/memory/consolidator.ts`) that extracts stable user-level
  facts from the chat transcript ~60s after the last turn. Per-session
  debounce, `audit.session({type: "memory_consolidate"})` log entry per
  pass, off-switch via `AUTO_GLOBAL_MEMORY=0` env or the Settings toggle
  (persisted to `/root/.memory/auto-config.json`). The runner uses the
  Agent SDK in one-shot mode (`tools: [], settingSources: [], maxTurns: 1`)
  so it piggybacks on the existing `~/.claude/.credentials.json` auth.
- **Per-project memory** — `~/.claude/projects/<sanitized-cwd>/memory/`.
  Owned by the Claude Agent SDK's auto-memory feature
  (`autoMemoryEnabled` + `autoDreamEnabled`); the model reads/writes via
  the SDK's built-in memory protocol. We surface the directory in the UI
  but never write to it on the model's behalf.

Server boot patches `~/.claude/settings.json` once (idempotent) to enable
both SDK flags, ensures `/root/.memory/global/`, and runs the legacy
agent-config migration. `settingSources` includes `'user'` so the SDK
picks the memory flags up. The model emits `system/memory_recall` events
when memories are surfaced into a turn — the SessionManager forwards
these as `memory_recall` messages over the WebSocket.

Caps: 100 KB per file (curated), 5 KB total for `auto.md`, 10 MB total
per scope. Enforced server-side in `writeMemoryFile()` and
`auto-store.ts`. UI lives at **Settings → Memory** with global editing,
per-project drill-in, and an Auto-collected section showing the
consolidator's current state and a "Regenerate now" button.

The legacy `/api/agent-config/{system-prompt,rules}` HTTP routes still
work for one release window: their backends were swapped to read/write
from `/root/.memory/global/` via `src/lib/agent-config-legacy-adapter.ts`
and they emit a `Deprecation: true` header. Removal is scheduled
alongside `getCustomAppendForSdk()` (now a no-op).

## Chat previews

Image / file / link previews rendered inline in assistant messages. Three
same-origin proxy routes keep the strict CSP intact:

- `/api/files/serve?path=` — local files with correct `Content-Type` for inline `<img>` / `<video>` / `<iframe src=pdf>`.
- `/api/proxy/unfurl?url=` — fetches + parses + caches OpenGraph metadata.
- `/api/proxy/image?url=` — fetches + caches external images; unfurl responses rewrite `imageUrl` / `favicon` to point here.

Disk caches under `/root/.cache/` (bind-mounted, persists across restarts):

- `unfurls/<sha256>.json` — 24h TTL, 10k-file cap
- `images/<sha256>.<ext>` + `.meta.json` sidecar — 7d TTL, 1 GB cap

Both caches purge on boot + every 12h via node-cron in `server.ts`.

### SSRF hardening (critical)

Every proxy fetch goes through `assertPublicUrl()` in
`src/lib/proxy/ssrf-guard.ts` — rejects private IPv4 (10/8, 172.16/12,
192.168/16, 127/8, 169.254/16 including AWS metadata, CGNAT, TEST-NETs),
IPv6 loopback/ULA/link-local, and non-http(s) schemes. `fetchWithHops`
re-runs the guard on every redirect hop (3 max) to block redirect-based
SSRF. Body size is capped per route (unfurl 2 MB, image 10 MB).

### Client components

- `ImagePreview` — auto-routes local paths through `/api/files/serve` and external URLs through `/api/proxy/image`; click opens global `<Lightbox>`.
- `LinkPreview` — lazy-fetches unfurl via `useUnfurl` (in-memory + disk cache); renders compact card below the inline link.
- `SyntaxCode` — lazy-loads shiki, bundled langs: ts/tsx/js/jsx/python/rust/go/java/bash/json/yaml/markdown/sql/html/css/diff. Copy button + plain-pre fallback while loading.
- `FilePathPill` — inline chip opening the file in the existing editor panel via URL `?open=…&active=…`.
- `ToolResultBlock` specialises per `toolName`: Read on an image → inline `ImagePreview`, WebFetch → unfurl card + collapsed body, WebSearch → stack of mini cards, Write/Edit → file pill + collapsed diff, everything else → file-path detection inside the raw output.

### Adding a new preview type

Wire it in `markdown-renderer.tsx` (for assistant text) or add a branch in
`ToolResultBlock` (for tool-specific previews). Keep preview fetches
same-origin — direct external `<img>`/`fetch()` is blocked by CSP.

### File attachments in assistant prose

When Claude mentions local file paths in its text (e.g. a bulleted list
of `.pptx` / `.html` sources), the markdown renderer converts them into
**attachment cards** (when alone on a line/bullet) or **compact pills**
(when embedded in prose):

- `src/components/chat/previews/file-card.tsx` — full attachment card.
  - Images → reuses `ImagePreview`.
  - PDFs → `<iframe src=/api/files/serve>` (480 px, scrollable, lazy-loaded).
  - Video / audio → native `<video>` / `<audio>` with `controls`.
  - Anything else → icon + filename + `prettyMimeLabel` + size + `[Preview] [Download]` buttons.
- `src/components/chat/previews/file-path-pill.tsx` — compact chip; right-click or long-press opens a portal menu with `Preview` / `Download` / `Copy path`.
- `src/lib/detect-file-paths.ts`:
  - Extended regex covers Office (`pptx`/`docx`/`xlsx`), archives, media, plus the original code/text/image set — still gated on a path separator (`/`, `~/`, `./`).
  - `isLonePathLine(line)` tells the renderer whether a paragraph/list-item segment should become a card or a pill.
- `src/app/api/files/stat/route.ts` — lightweight size/mtime/mime endpoint consumed by the hook `useFileStat` (in-memory cached, 100 ms debounce).
- `remark-breaks` is added so single newlines in assistant text become `<br>` elements — this gives the `p`/`li` overrides something to split on when they scan for lone-path lines.
- Card Preview buttons reuse the existing floating editor panel via the `?open=…&active=…` URL pattern; binary files degrade to `BinaryPlaceholder`'s download-link fallback.
- Download buttons use a same-origin `<a href="/api/files/download?path=…" download>` — the browser handles the save dialog and the httpOnly session cookie rides along.

## Security Checklist

- All API routes must call `extractSession(request)` first
- File operations must use `safePath()` for user-provided paths
- Session cookies: HMAC-signed, HttpOnly, SameSite=Strict, Secure in prod
- CSP configured in `next.config.ts` — update when adding external resources
- No `eval()`, `innerHTML`, or `dangerouslySetInnerHTML`
- Audit log: never pass `process.env`, request bodies, or session cookies into
  `audit.*()` calls; producers rely on `scrubDetails` as a last line of defense

## Self-Evaluation — Run Before Completing Any Task

1. `npx tsc --noEmit` — no type errors
2. `npm test` — all tests pass
3. `npm run lint` — no lint errors
4. `npm run format:check` — formatting clean
5. No secrets in committed files
6. New API routes include auth checks
7. File path operations use safePath()
