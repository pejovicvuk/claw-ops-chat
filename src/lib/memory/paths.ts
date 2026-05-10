import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

import { PROJECTS_ROOT } from "../projects/paths";
import { assertProjectSlug } from "../projects/validation";

/**
 * Server-only paths and constants for the Memory subsystem. Mirrors the
 * shape of `src/lib/projects/paths.ts` so the layout lives in one file.
 *
 * Two scopes:
 *   - **Global** memory: ours. Always read into the system-prompt append.
 *   - **Per-project** memory: SDK-managed. The Claude Agent SDK writes
 *     auto-memory to `~/.claude/projects/<sanitized-cwd>/memory/` when
 *     `autoMemoryEnabled` is true. We surface those directories in the
 *     UI but never write to them ourselves on the model's behalf — the
 *     SDK owns that namespace.
 */

/** Root for global memory. Override with MEMORY_ROOT. */
export const MEMORY_ROOT: string = process.env.MEMORY_ROOT || join(homedir(), ".memory");

/** Caps from Anthropic's memory tool documentation. */
export const MAX_FILE_BYTES = 100 * 1024;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

/** Directory holding global memory `.md` files. */
export function globalMemoryDir(): string {
  return join(MEMORY_ROOT, "global");
}

/**
 * Sanitize a cwd into the directory-name shape the Claude Agent SDK uses
 * for both transcripts and auto-memory: every `/` becomes `-`. Confirmed
 * against `/root/.claude/projects/-root-projects-test-claw-ops-chat/`.
 */
export function sanitizeCwdForClaude(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

/** Where the SDK writes auto-memory for a given cwd. */
export function sdkMemoryDirForCwd(cwd: string): string {
  return join(homedir(), ".claude", "projects", sanitizeCwdForClaude(cwd), "memory");
}

/**
 * Where the SDK writes auto-memory for a given project slug, given how
 * the Projects feature lays out per-project working directories.
 */
export function sdkMemoryDirForProjectSlug(slug: string): string {
  assertProjectSlug(slug);
  return sdkMemoryDirForCwd(join(PROJECTS_ROOT, slug));
}

/** Create the global memory directory if missing. Called once at boot. */
export async function ensureMemoryTree(): Promise<void> {
  const dir = globalMemoryDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}
