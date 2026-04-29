# Architecture Docs

Reference documentation for the Claw Chat codebase. Auto-loaded entry point
for Claude Code sessions is `.claude/CLAUDE.md`, which links here.

For day-to-day commands and conventions, see the root [`CLAUDE.md`](../../CLAUDE.md).

## What's in here

| Doc                                  | Read it when…                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [file-map.md](./file-map.md)         | You need to find a feature by name, or want a directory-by-directory inventory of the repo.       |
| [api-routes.md](./api-routes.md)     | You're adding, modifying, or auditing an HTTP route. Has every `route.ts` grouped by feature.     |
| [runtime.md](./runtime.md)           | You're touching `server.ts`, the chat WebSocket, the SessionManager, the SDK loop, or boot order. |
| [subsystems.md](./subsystems.md)     | You're working on audit, push, monitoring, reports, projects, proxy, git, file system, or auth.   |
| [integrations.md](./integrations.md) | You're connecting an external service: Spring backend, OAuth provider, MCP server, STT, Web Push. |

## Task-to-doc cheat sheet

| Task                                                     | Start here                                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Add an API route                                         | [api-routes.md — adding a new route](./api-routes.md#adding-a-new-route--checklist)                |
| Trace a chat message end-to-end                          | [runtime.md — chat WebSocket protocol](./runtime.md#chat-websocket-protocol)                       |
| Investigate why an audit event is or isn't being written | [subsystems.md — audit](./subsystems.md#audit)                                                     |
| Add or change a tool's preview rendering                 | [subsystems.md — proxy & previews](./subsystems.md#proxy--previews)                                |
| Hook in a new MCP server                                 | [integrations.md — when adding a new integration](./integrations.md#when-adding-a-new-integration) |
| Wire up a new OAuth provider                             | [integrations.md — OAuth providers](./integrations.md#oauth-providers)                             |
| Schedule a recurring Claude job                          | [subsystems.md — reports](./subsystems.md#reports-scheduled-claude-jobs)                           |
| Add a monitoring metric or alert rule                    | [subsystems.md — monitoring](./subsystems.md#monitoring)                                           |
| Add a new automation action (force-gc, prune, …)         | `src/lib/monitoring/automation/actions/`                                                           |
| Find where session state is persisted to disk            | [runtime.md — disk persistence](./runtime.md#disk-persistence)                                     |
| Adjust SSRF or preview cache caps                        | [subsystems.md — proxy & previews](./subsystems.md#proxy--previews)                                |
| Track down a permission gate decision                    | [runtime.md — permission gates](./runtime.md#permission-gates-canusetool)                          |
| Understand the cron jobs the server starts at boot       | [runtime.md — cron jobs](./runtime.md#cron-jobs-registered-at-boot)                                |
| Find a React hook                                        | [file-map.md — `src/lib/` top-level files](./file-map.md#top-level-files) (search `use-`)          |
| Find a settings page                                     | [file-map.md — `settings/pages/`](./file-map.md#settings)                                          |
| Add a new push notification trigger                      | [subsystems.md — push](./subsystems.md#push-notifications)                                         |

## Conventions

- All routes are under `basePath: "/chat"` — see `next.config.ts`.
- TypeScript is strict. `any` is forbidden — use `unknown` and narrow.
- Path alias `@/*` → `src/*`.
- Tests are co-located: `foo.test.ts` next to `foo.ts`.
- File paths from user input go through `safePath()`; never bare
  `path.join` / `path.resolve`. See `.claude/rules/security.md`.

## Keeping these docs accurate

These are reference docs, not generated. When you add a feature:

1. Add a row to [file-map.md](./file-map.md) for new files.
2. Add the route to [api-routes.md](./api-routes.md) if you added one.
3. Update [subsystems.md](./subsystems.md) if you changed how a subsystem
   works on disk or in protocol.
4. Update [runtime.md](./runtime.md) if you touched `server.ts`'s boot order,
   WebSocket protocol, or SessionManager.
5. Don't duplicate — root `CLAUDE.md` owns commands and security checklist.
