import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";

/**
 * Idempotently turn on the Claude Agent SDK's auto-memory feature by
 * patching `~/.claude/settings.json`. With `settingSources` including
 * `'user'`, the SDK picks these up on every `query()` call.
 *
 * - `autoMemoryEnabled: true` — model reads/writes its memory directory
 *   (per-cwd: `~/.claude/projects/<sanitized-cwd>/memory/`).
 * - `autoDreamEnabled: true` — background memory consolidation.
 *
 * Other keys are preserved. Safe to call on every server boot.
 */

interface ClaudeUserSettings {
  autoMemoryEnabled?: boolean;
  autoDreamEnabled?: boolean;
  [k: string]: unknown;
}

export function userSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

export async function ensureSdkAutoMemoryEnabled(): Promise<void> {
  const path = userSettingsPath();

  let current: ClaudeUserSettings = {};
  try {
    const raw = await readFile(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      current = parsed as ClaudeUserSettings;
    }
  } catch {
    /* missing or malformed — start fresh */
  }

  if (current.autoMemoryEnabled === true && current.autoDreamEnabled === true) {
    return;
  }

  const next: ClaudeUserSettings = {
    ...current,
    autoMemoryEnabled: true,
    autoDreamEnabled: true,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2) + "\n", "utf-8");
}
