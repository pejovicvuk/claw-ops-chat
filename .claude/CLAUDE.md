# Claw Chat — Session Bootstrap

This file is auto-loaded at the start of every Claude Code session in this
repo. It points at deeper docs instead of duplicating them.

## What this project is

A Next.js 16 + custom Node.js server that hosts a chat UI for the Claude
Agent SDK. One process serves HTTP (under `/chat`) and four WebSocket
endpoints. Single-user, gated by `ALLOWED_EMAIL`, with a Spring backend for
auth. Lives in production behind Docker on `node:24-alpine`.

The runtime entry point is **`server.ts`** at the repo root. It owns the
SessionManager (in-memory chat sessions keyed by UUID), iterates the
SDK message stream, broadcasts events to connected WebSocket clients,
schedules cron jobs (audit retention, preview cache purge), and bootstraps
the monitoring + reports + push subsystems.

## Conventions, commands, security

See **[`../CLAUDE.md`](../CLAUDE.md)** (the root `CLAUDE.md`) for:

- `npm` commands (dev, build, test, lint, format, typecheck)
- TypeScript / React naming + style rules
- Git workflow (conventional commits, no force-push, PRs)
- Security checklist (auth, `safePath()`, CSP, no secrets)
- Self-evaluation checklist before completing a task

Also relevant:

- `.claude/rules/api-routes.md` — every API route MUST start with
  `extractSession(request)` and return `unauthorized()` on null
- `.claude/rules/security.md` — file paths MUST go through `safePath()`
- `.claude/rules/code-style.md` — TS strict, no `any`, kebab-case files
- `.claude/rules/testing.md` — Vitest, co-located tests

## Architecture docs (read these on demand)

| Doc                                                                         | Read when…                                                                  |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`docs/architecture/README.md`](../docs/architecture/README.md)             | You're not sure where to look — has a task→doc grid                         |
| [`docs/architecture/file-map.md`](../docs/architecture/file-map.md)         | Find a file or feature by name; full directory inventory                    |
| [`docs/architecture/api-routes.md`](../docs/architecture/api-routes.md)     | Adding/modifying any HTTP route — every `route.ts` grouped by feature       |
| [`docs/architecture/runtime.md`](../docs/architecture/runtime.md)           | Touching `server.ts`, WebSocket, SessionManager, SDK loop, or boot order    |
| [`docs/architecture/subsystems.md`](../docs/architecture/subsystems.md)     | Audit / push / monitoring / reports / projects / proxy / git / files / auth |
| [`docs/architecture/integrations.md`](../docs/architecture/integrations.md) | Spring backend / SDK / Bitbucket MCP / OAuth providers / STT / Web Push     |

## Where things live (cheat sheet)

| Need…                                       | Path                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Server entry point                          | `server.ts`                                                                              |
| Bitbucket MCP server (16 tools)             | `bitbucket-mcp.ts` + `skills/bitbucket/`                                                 |
| All HTTP API routes                         | `src/app/api/`                                                                           |
| Chat UI (layout, view, input)               | `src/components/chat/`                                                                   |
| File browser + editor                       | `src/components/chat/file-browser/`, `…/file-editor/`                                    |
| Inline previews (links, images, code)       | `src/components/chat/previews/`                                                          |
| Settings UI                                 | `src/components/settings/pages/`                                                         |
| Monitoring UI                               | `src/components/monitoring/`                                                             |
| Audit subsystem                             | `src/lib/audit/`                                                                         |
| Push notifications                          | `src/lib/push/` + `public/sw.js`                                                         |
| Monitoring (collectors, alerts, automation) | `src/lib/monitoring/`                                                                    |
| Scheduled reports                           | `src/lib/reports/`                                                                       |
| Image / unfurl proxy + SSRF guard           | `src/lib/proxy/`                                                                         |
| Git operations (read-only)                  | `src/lib/git/`                                                                           |
| Path safety (`safePath`, `safeFilename`)    | `src/lib/safe-path.ts`                                                                   |
| Auth (HMAC cookies, ws-tickets)             | `src/lib/auth-server.ts`, `src/lib/ws-ticket-store.ts`                                   |
| Spring backend client                       | `src/lib/api-backend.ts`, `src/lib/apiClient.ts`                                         |
| OAuth provider configs                      | `src/lib/{google,github,microsoft,bitbucket,jira,linear,notion,trello}-custom-config.ts` |
| MCP server registration                     | `src/lib/mcp-register.ts` (writes `~/.claude.json`)                                      |
| Shared types                                | `src/lib/types.ts`                                                                       |
| Tests (co-located)                          | `src/**/*.test.ts`                                                                       |
| PWA service worker                          | `public/sw.js`                                                                           |
| Harness config (this dir)                   | `.claude/{settings.json,rules,hooks,agents,skills}`                                      |

## Persistence on disk (inside container)

Bound to host as a single `/root` volume. Quick reference:

| Path                                               | What                                               |
| -------------------------------------------------- | -------------------------------------------------- |
| `/root/.audit/{api,cron,session}/YYYY-MM-DD.jsonl` | Audit log files (rotated daily, purged after 30 d) |
| `/root/.cache/unfurls/`, `/root/.cache/images/`    | Preview caches (24 h / 7 d TTL)                    |
| `/root/.session-status/<id>.json`                  | SessionManager status snapshot                     |
| `/root/.claude/projects/<hash>/<id>.jsonl`         | SDK chat transcripts                               |
| `/root/.claude/.credentials.json`                  | Claude IDE credentials                             |
| `/root/.push/vapid.json`                           | Web Push VAPID keypair                             |
| `~/.claude.json`                                   | MCP servers + global Claude config                 |

## Hooks installed in this repo

`.claude/settings.json` configures these — they run automatically:

- **PreToolUse on Edit/Write** — `protect-files.sh` blocks edits to protected paths
- **PreToolUse on Bash** — blocks `git push --force` to main/master
- **PostToolUse on Edit/Write** — `auto-format.sh` (prettier) + `auto-lint.sh` (eslint)
- **Stop** — `stop-verify.sh` runs verification

If you see a "blocked by hook" error, read the hook script first — usually
the right move is to comply, not bypass.

## When in doubt

1. **Looking for a file?** → `docs/architecture/file-map.md`
2. **Working on a route?** → `docs/architecture/api-routes.md`
3. **Touching `server.ts`?** → `docs/architecture/runtime.md`
4. **Subsystem behavior?** → `docs/architecture/subsystems.md`
5. **Connecting a service?** → `docs/architecture/integrations.md`
6. **Conventions / commands?** → root `CLAUDE.md`
