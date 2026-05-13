# External Integrations

Outside services this app talks to: the Spring backend that fronts auth, the
Claude Agent SDK, the in-process Bitbucket MCP server, every OAuth provider
the user can connect, the speech-to-text providers, and the Web Push browser
contract.

For the API routes that drive each integration, see
[api-routes.md](./api-routes.md).

---

## Spring backend (auth)

The Next.js app does **not** own its user table — it delegates login + token
refresh to a Spring backend.

**Source:** `src/lib/api-backend.ts` (server-side calls), `src/lib/apiClient.ts`
(fetch wrapper with JWT + refresh).

**Flow:**

1. Browser POSTs credentials to Spring (`api-backend.ts:loginApi()`).
2. Spring returns `{ accessToken, refreshToken, user }`.
3. Browser stores both tokens via `auth.ts` (localStorage).
4. Browser POSTs to `/api/auth/session` (`src/app/api/auth/session/route.ts`)
   to mint an HMAC-signed session cookie. The route re-validates the JWT
   email against `ALLOWED_EMAIL` server-side.
5. Subsequent API calls authenticate via the cookie (see
   [subsystems.md#auth-server-side](./subsystems.md#auth-server-side)).
6. `apiClient.ts` auto-refreshes the access token on 401 using the refresh
   token; if refresh fails, the user is logged out.

**Env vars:**

- `NEXT_PUBLIC_API_ORIGIN` — scheme + host of the Spring backend (default `http://localhost:8080`).
- `ALLOWED_EMAIL` — single user allowed to mint a session cookie.

**Self-loop guard:** `server.ts` warns at boot if `NEXT_PUBLIC_API_ORIGIN`
resolves to itself (would cause infinite proxy chain).

---

## Claude Agent SDK

Package: `@anthropic-ai/claude-agent-sdk`.

**Loader:** `sdk-loader.js` (root) is a CJS-only `require()` shim. Reason:
the SDK ships ESM-first, and esbuild's transform pipeline can mangle it
during the Next.js build. The shim sidesteps that.

**Invocation:** see [runtime.md#claude-agent-sdk-integration](./runtime.md#claude-agent-sdk-integration) — the full `query({ ... })` shape, message-stream events, and permission gates.

**Per-turn config sources:**

- `mcpServers` — re-read from `~/.claude.json` each turn so newly added MCP
  servers take effect mid-session without restart.
- `systemPrompt: { preset: "claude_code", append: customPrompt }` — custom
  prompt loaded from `agent-config.ts` (Settings → Agent → System prompt).
- `settingSources: ["project"]` — pulls in `.claude/rules/*.md`,
  `.claude/agents/*.md`, `.claude/skills/*`.
- `env` — parent env extended with provider-specific vars (`JIRA_*`,
  `TRELLO_*`, …) so MCP servers spawned by the SDK inherit credentials.
- `spawnClaudeCodeProcess: spawnClaude` — controls how subprocess Claude is
  spawned (used by some tools).

**MCP config file:** `~/.claude.json` (managed by `src/lib/mcp-register.ts`).
Adding a new MCP server is a matter of writing the right block here — the
SDK picks it up on the next turn.

---

## Bitbucket MCP server (in-process)

A small stdio MCP server that exposes 16 read-only Bitbucket Cloud tools.
Bundled in this repo so the user only needs API credentials.

**Source:** `bitbucket-mcp.ts` (root) + `skills/bitbucket/bitbucket-cli.sh`.

**Transport:** stdio — the SDK spawns `node bitbucket-mcp.js` on demand and
talks JSON-RPC over its stdin/stdout.

**Tools exposed (16):**

| Tool                     | What it does                                     |
| ------------------------ | ------------------------------------------------ |
| `bitbucket_repos`        | List repos in the workspace (max 50)             |
| `bitbucket_prs`          | List PRs (`OPEN` / `MERGED` / `DECLINED`)        |
| `bitbucket_pr`           | PR details                                       |
| `bitbucket_diffstat`     | File-change summary for a PR                     |
| `bitbucket_diff`         | Raw unified diff for a PR                        |
| `bitbucket_comments`     | PR comments (inline + general)                   |
| `bitbucket_pr_commits`   | Commits in a PR                                  |
| `bitbucket_branches`     | Branches (optional name filter)                  |
| `bitbucket_commits`      | Last 10 commits on a branch                      |
| `bitbucket_file`         | Raw file contents (optional branch)              |
| `bitbucket_ls`           | Directory listing (optional branch)              |
| `bitbucket_tree`         | Recursive directory tree                         |
| `bitbucket_search`       | Code search across workspace or single repo      |
| `bitbucket_compare`      | Unified diff between two branches (no PR needed) |
| `bitbucket_build_status` | CI / build status for a commit                   |
| `bitbucket_pr_status`    | Approval / review / CI status for a PR           |

**Read-only by design** — no create / merge / approve / modify operations.

**Implementation:** each tool spawns `bash skills/bitbucket/bitbucket-cli.sh
<args>` via `child_process.spawn`. The CLI uses `curl` + `python3` for JSON
parsing. Tool results wrap stdout in MCP's `{ content: [{ type: "text", text }] }`
shape; non-zero exit → `isError: true` with stderr.

**Env vars:**

- `ATLASSIAN_EMAIL` — login email
- `BITBUCKET_API_TOKEN` — read-only scoped token
- `BITBUCKET_WORKSPACE` — workspace slug
- `BITBUCKET_CLI` — path to the CLI script (default
  `/opt/skills/bitbucket/bitbucket-cli.sh` in the container)

**Docker:** the skill is mounted read-only at `/opt/skills/bitbucket` per
`docker-compose.yml`.

---

## OAuth providers

Eight OAuth-style integrations. Each lives under `src/app/api/{provider}-custom/`
with at least `credentials/route.ts` + `status/route.ts`. The provider-specific
config file in `src/lib/{provider}-custom-config.ts` writes credentials into
`~/.claude.json` so the SDK can spawn the corresponding MCP server with the
right env / arguments.

| Provider  | Flow             | Notes                                                                                                                                                                                                                                                                                                   |
| --------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google    | Device + Web     | Wizard at Settings → Connections → Google. Device flow for headless setup; web flow for browser; scopes managed by `google-custom-scopes.ts` (Drive / Gmail / Calendar / Workspace). OAuth callback at `/api/google-custom/oauth-callback`. Tokens persisted via `google-workspace-mcp-tokens.ts`.      |
| GitHub    | Token            | `gh` CLI is bundled in the container; `credentials/route.ts` writes the PAT and runs `gh auth login --with-token`. See commit `536b56f` (`feat: add gh CLI and sync it with GitHub PAT on connect/disconnect`).                                                                                         |
| Microsoft | Device flow only | `microsoft-custom-scopes.ts` deliberately **excludes** Teams scopes (`Teams.ReadBasic.All`, `ChannelMessage.Read.All`, `Chat.ReadWrite`) — they require tenant admin consent and break the device-code flow. Firms can grant Teams access manually via Azure Portal post-connect. See commit `cd1e05d`. |
| Bitbucket | Token            | The MCP server above is the consumer; this just stores `ATLASSIAN_EMAIL`/`BITBUCKET_API_TOKEN`/`BITBUCKET_WORKSPACE`.                                                                                                                                                                                   |
| Jira      | Token            | `jira-custom-config.ts` — credentials forwarded to the SDK via `JIRA_*` env vars.                                                                                                                                                                                                                       |
| Linear    | Token            | API key stored; consumed by Linear MCP server.                                                                                                                                                                                                                                                          |
| Notion    | Token            | API key stored; consumed by Notion MCP server.                                                                                                                                                                                                                                                          |
| Trello    | Token            | API key + token; forwarded via `TRELLO_*` env vars to the SDK.                                                                                                                                                                                                                                          |

**Pattern:** every provider's `credentials/route.ts` + `status/route.ts` is
intentionally similar so the Settings UI (`src/components/settings/connection-row.tsx`)
can drive them all uniformly.

### Generic MCP auth bridge (`/api/mcp-auth/*`)

For MCP servers that have their own OAuth flow (not handled by a custom
provider above), `mcp-auth-sessions.ts` brokers the OAuth flow:

- `/api/mcp-auth/connect` — start OAuth for a named MCP server
- `/api/mcp-auth/submit-code` — submit OAuth code
- `/api/mcp-auth/cancel` — cancel pending flow
- `/api/mcp-auth/disconnect` — revoke + remove tokens

---

## Web Push (browser → server)

The browser-side half of the [push subsystem](./subsystems.md#push-notifications).

**Contract:**

1. On first run, the client fetches `/api/push/vapid-key` for the public key.
2. `use-sw-registration.ts` registers `public/sw.js` (scope `/chat/`).
3. `use-push-subscription.ts` calls `pushManager.subscribe({ applicationServerKey })`.
4. Subscription posted to `/api/push/subscriptions` (POST).
5. Server stores it via `src/lib/push/store.ts`; sends notifications via
   `src/lib/push/send.ts` (uses the `web-push` library; signs with the
   stored VAPID keypair).

**On-disk state:**

- `/root/.push/vapid.json` — VAPID keypair (auto-generated on first request)
- `/root/.push/subscriptions.json` — subscription store

**Service worker behavior** — see [subsystems.md#push-notifications](./subsystems.md#push-notifications) for cache name, fetch policy, active-chat tracking, and the `focusBehavior: "smartChat"` notification suppression.

---

## Docker host integrations

Used by the monitoring subsystem; not user-facing.

- **Docker socket** — `/var/run/docker.sock` mounted read-only; `dockerode`
  used by `src/lib/monitoring/collectors/docker.ts` to list / inspect / log
  containers, and by automation actions (`prune-docker-images`,
  `prune-docker-logs`, `restart-unhealthy-container`).
- **Host `/proc`, `/sys`, `/etc/os-release`** — bind-mounted read-only;
  `systeminformation` reads them via `HOST_PROC` / `HOST_SYS` / `HOST_ETC`
  env vars (set in `docker-compose.yml`).

---

## When adding a new integration

1. **OAuth-style with a SaaS API:** clone the shape of `src/lib/jira-custom-config.ts` (token-based) or `microsoft-custom-config.ts` (device flow). Add `/api/{provider}-custom/credentials` + `/status` routes. Add a settings page under `src/components/settings/pages/`. Register the MCP server (if any) via `mcp-register.ts`.
2. **MCP server (no OAuth):** write a small `<thing>-mcp.ts` next to `bitbucket-mcp.ts`, register tools via `McpServer.registerTool()`. Add to the `mcpServers` config produced by `loadMcpServers()` (called per turn in `server.ts`). Document the tools here.
3. **Always:** state-changing routes wrap with `withAudit(...)`, file paths go through `safePath()`, and credentials never enter the audit log (see `scrub.ts`).
