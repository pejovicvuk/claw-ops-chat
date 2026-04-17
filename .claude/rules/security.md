# Security Rules

## Authentication

- Single-user model gated by `ALLOWED_EMAIL` env var (case-insensitive).
- HMAC-signed session cookies with timing-safe comparison in `auth-server.ts`.
- Cookie flags: HttpOnly, SameSite=Strict, Path=/chat, Secure (production).
- Never log or expose session tokens.

## Path Traversal Prevention

- ALL file system operations on user-provided paths MUST use `safePath()` from `src/lib/safe-path.ts`.
- Never use `path.join()` or `path.resolve()` directly on user input.
- The `safeFilename()` helper strips directory components from uploaded names.

## Content Security Policy

- CSP configured in `next.config.ts` with WebSocket support (`ws:` / `wss:`).
- Update CSP directives when adding new external resources.
- Never add `unsafe-eval` to `script-src`.

## Secrets

- Never commit `.env`, `.credentials.json`, or files containing secrets.
- Use `process.env` with fallback defaults for optional config.
- `SESSION_SECRET` auto-generates if not provided (acceptable for single-instance).
