# Testing Conventions

## Framework

- Vitest (NOT Jest). Default config (no vitest.config.ts needed).
- Test files co-located with source: `foo.test.ts` next to `foo.ts`.

## Patterns

```typescript
import { describe, it, expect } from "vitest";

describe("functionName", () => {
  it("describes expected behavior", () => {
    expect(functionName(input)).toBe(expected);
  });
});
```

## Rules

- Every new utility function in `src/lib/` should have a test file.
- Test both happy path and error/edge cases.
- Use descriptive test names: "rejects paths that traverse above base directory".
- No test should depend on external services or network calls.
- Run all tests: `npm test`
- Single file: `npx vitest run path/to/file.test.ts`
- Watch mode: `npm run test:watch`
