# Next Session Prompt: UI Polish for claw-ops-chat

Copy-paste this into your next Claude Code session:

---

I'm working on the UI polish for claw-ops-chat — a Next.js 16 web chat interface for Claude Code. The app is at `/root/claw-ops-chat`, deployed via Docker at `https://claw-agents-16gb.viksi.ai/chat/`. It ships tomorrow.

## What the app does
It's a mobile-first chat UI where employees talk to Claude Code running on their server. Think of it as Claude Code in a browser. It has a 3-panel layout (session sidebar | chat | file browser), permission modes (Default/Accept Edits/Plan), effort levels, file upload, and session persistence.

## Current state
The functionality works — messages stream, permissions prompt correctly, sessions persist, files upload. But the UI needs polish before shipping. The design uses CSS custom properties (`--canvas-bg`, `--canvas-fg`, etc.) with light/dark mode via `next-themes`.

## What needs UI work

### Priority 1: Chat feel
- The live tool activity indicator (shows "Reading file... path") works but could look better — maybe animate it, add a subtle progress feel
- The thinking dots at the bottom could be more refined
- Message transitions when new messages appear could be smoother
- The empty state ("Send a message to start...") needs a better design — maybe show the Claude logo and some suggested prompts

### Priority 2: Permission modal
- The permission modal pops up when Claude wants to use a tool — it works but could feel more polished
- Consider: should it slide up from bottom on mobile instead of center overlay?
- The "Always allow X this session" button needs better visual hierarchy

### Priority 3: Overall layout
- The header could show more info (which server, connection quality)
- The session sidebar items could show more context (message count, last message preview)
- The mode/effort bar could be more compact or integrated into the header
- Dark mode needs testing — ensure all custom colors work in both themes

### Priority 4: Mobile experience
- Test on actual phone — keyboard handling, safe areas, scroll behavior
- The upload button and file button in the input area — are they discoverable enough?
- Sidebar overlay animation could be smoother
- Consider swipe gestures for sidebar

### Priority 5: Model selector
- Add a model picker (Sonnet/Opus/Haiku) — the SDK accepts a `model` option in query params
- Could be a dropdown in the mode/effort bar area
- Persist selection in localStorage

## Key files to read first
- `src/components/chat/chat-view.tsx` — main chat view with mode bar, messages, permission modal
- `src/components/chat/message-bubble.tsx` — all message type renderers
- `src/components/chat/chat-layout.tsx` — 3-panel responsive layout
- `src/components/chat/chat-input.tsx` — input textarea
- `src/app/globals.css` — design tokens, animations
- `server.ts` — for understanding what the `model` option looks like in query params

## Constraints
- Mobile-first — most users will be on phones
- Tailwind v4 with CSS custom properties for theming
- Keep it minimal and modern — no heavy component libraries
- Must work in both light and dark mode
- Changes need `npm run build && docker compose down && docker compose build && docker compose up -d` to deploy
