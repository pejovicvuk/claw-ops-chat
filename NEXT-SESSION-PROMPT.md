# Next Session: Connections Management in claw-ops-fe

Copy-paste this into your next Claude Code session:

---

I'm working on claw-ops-fe (`/root/claw-ops-fe`) — a Next.js 16 server management dashboard. When a user clicks on a server node on the canvas, a server dashboard panel opens. I need to add a **Connections** tab to this panel where users can manage their service integrations.

## What exists already

The canvas already shows small icons around each server node for detected services:

- **GitHub node** (`src/components/servers/github-node.tsx`) — 44px circle, detects `gh auth status` via SSH. Dashboard panel at `src/components/servers/github-dashboard-panel.tsx` shows account info, token management, git config.
- **Claude Code node** (`src/components/servers/claude-node.tsx`) — 44px orange circle, detects `claude --version` and `claude auth status`. Dashboard panel at `src/components/servers/claude-dashboard-panel.tsx` shows version, auth status, disk usage, projects.
- **Detection hooks**: `src/lib/use-github-accounts.ts` and `src/lib/use-claude-accounts.ts` — poll each ONLINE server via SSH commands, cache results in localStorage.

The server dashboard panel is at `src/components/servers/server-dashboard-panel.tsx` with collapsible sections (Terminal, Files, Health, Scripts).

## What I want

Add a **"Connections"** collapsible section to the server dashboard panel. It should show:

1. **GitHub** — Connected/Not connected status, account name if connected. Button to authenticate (opens interactive terminal with `gh auth login`) or disconnect.
2. **Claude Code** — Connected/Not connected, version, email. Button to authenticate (`claude auth login`) or update (`npm install -g @anthropic-ai/claude-code`).
3. **Codex** (OpenAI Codex CLI) — Connected/Not connected. Same pattern — detect via SSH, authenticate via interactive terminal.

Each connection should show:

- Service icon + name
- Status badge (green "Connected" / gray "Not connected")
- Account info when connected (username, email, version)
- Action button (Connect / Disconnect / Update)

Clicking "Connect" should open an interactive terminal overlay (the existing `ClaudeCodeOverlay` pattern at `src/components/servers/claude-dashboard-panel.tsx` uses this — it opens a fullscreen xterm.js terminal for interactive auth flows).

## Key files to read first

- `src/components/servers/server-dashboard-panel.tsx` — main panel, add section here
- `src/components/servers/github-dashboard-panel.tsx` — reference for GitHub integration pattern
- `src/components/servers/claude-dashboard-panel.tsx` — reference for Claude integration + interactive terminal overlay
- `src/lib/use-github-accounts.ts` — detection hook pattern
- `src/lib/use-claude-accounts.ts` — detection hook pattern
- `src/lib/api.ts` — `executeCommandApi()` for running SSH commands

## Constraints

- Reuse existing detection hooks (`useGithubAccounts`, `useClaudeAccounts`) — don't duplicate
- For Codex, create a new `use-codex-accounts.ts` following the same pattern (detect via `codex --version` or similar)
- The interactive terminal overlay pattern already exists — reuse it
- Match the existing UI style (collapsible sections, status badges, action buttons)
- Must work on both desktop panels and mobile dashboard views
