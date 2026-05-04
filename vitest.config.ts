import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest 4 no longer sets NODE_ENV=test by default. React 19's `act`
 * helper is only exposed when NODE_ENV is "test"; without it,
 * `@testing-library/react`'s renderHook/render hit "React.act is not a
 * function" the moment a hook updates state. Setting it here fixes
 * every React-hook test in the project (this one + the existing
 * `use-exit-animation.test.ts`).
 *
 * The `@/` alias mirrors the tsconfig "paths" entry so component tests
 * can import source modules using the same alias the production code
 * uses (without rewriting source files to relative paths).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    env: {
      NODE_ENV: "test",
    },
    // Runs once per worker before any test file is imported. We use it
    // to set CLAUDE_CWD so safe-path.ts picks up a sandbox BASE_DIR
    // instead of production's permissive root default. See
    // vitest.setup.ts for the why.
    setupFiles: ["./vitest.setup.ts"],
    // Build outputs sometimes contain stale copies of *.test.ts(x) that
    // Vitest will try to execute and fail to resolve dev-only React
    // bundles in. Exclude them alongside the defaults.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/build/**"],
  },
});
