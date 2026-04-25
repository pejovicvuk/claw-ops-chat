import { defineConfig } from "vitest/config";

/**
 * Vitest 4 no longer sets NODE_ENV=test by default. React 19's `act`
 * helper is only exposed when NODE_ENV is "test"; without it,
 * `@testing-library/react`'s renderHook/render hit "React.act is not a
 * function" the moment a hook updates state. Setting it here fixes
 * every React-hook test in the project (this one + the existing
 * `use-exit-animation.test.ts`).
 */
export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
    },
  },
});
