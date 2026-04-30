/**
 * Vitest global setup — runs once before any test file is imported.
 *
 * Production `safe-path.ts` defaults BASE_DIR to "/" because the chat
 * runs as root inside its container and the trust boundary is the
 * single-user `ALLOWED_EMAIL` gate, not the path check (see comments
 * in src/lib/safe-path.ts). With BASE_DIR="/" the path-traversal tests
 * in safe-path.test.ts cannot detect anything because everything is
 * inside root — they assume a sandboxed BASE_DIR.
 *
 * Setting CLAUDE_CWD here gives the tests a real sandbox to assert
 * against, so they actually exercise the protection mechanism that
 * exists when the env var is configured. Production behavior is
 * untouched — only the test process sees this value.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs") as typeof import("fs");

const SANDBOX = "/tmp/claw-ops-test-sandbox";
fs.mkdirSync(SANDBOX, { recursive: true });
process.env.CLAUDE_CWD = SANDBOX;
