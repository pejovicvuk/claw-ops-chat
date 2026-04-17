---
globs: src/app/api/**
---

# API Route Conventions

## Authentication

Every API route handler MUST call `extractSession(request)` as the first line
and return `unauthorized()` if null. The only exception is the health check.

```typescript
import { extractSession, unauthorized } from "@/lib/auth-server";

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  // ... handler logic
}
```

## Response Format

- Success: `Response.json(data)` (200 by default)
- Error: `Response.json({ error: "message" }, { status: 4xx/5xx })`
- Never expose stack traces or internal paths in error messages.

## File Operations

Any route accepting a file path from user input MUST validate with `safePath()`:

```typescript
import { safePath, SafePathError } from "@/lib/safe-path";

try {
  const validated = await safePath(userPath);
} catch (err) {
  if (err instanceof SafePathError) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }
}
```

## Route Structure

- `src/app/api/{resource}/route.ts` for collection endpoints
- `src/app/api/{resource}/[id]/route.ts` for individual resources
- Export named functions matching HTTP methods: GET, POST, PUT, DELETE
