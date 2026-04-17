---
name: deploy
description: Build and deploy the application using Docker
user-invocable: true
allowed-tools: Bash, Read
---

# Deploy

## Steps

1. Run pre-deploy checks:
   - `npx tsc --noEmit` (type check)
   - `npm test` (tests)
   - `npm run lint` (lint)
   - `npm run format:check` (formatting)
2. If any check fails, stop and report the issue.
3. Build Docker image: `docker compose build`
4. Deploy: `docker compose up -d`
5. Wait for health check: `curl -sf http://127.0.0.1:3100/chat/api/health`
6. Report deployment status.

## Notes

- Production image uses node:24-alpine with standalone Next.js output.
- Volume mounts: Claude credentials (ro), session persistence (rw).
- Health check endpoint: `/chat/api/health`
- Ensure `.env` file exists before deploying.
