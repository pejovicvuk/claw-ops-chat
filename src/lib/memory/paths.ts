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

/**
 * Auto-collected memory cap. Tighter than the curated cap because every
 * byte here lands in the system prompt of every chat in every project.
 * 5 KB ≈ 1,250 tokens — enough for a handful of stable user-level facts.
 */
export const AUTO_MEMORY_MAX_BYTES = 5 * 1024;

/** Filename of the single auto-collected memory file under globalMemoryDir(). */
export const AUTO_MEMORY_FILENAME = "auto.md";

/** Where the consolidator's auto-collected facts live. */
export function autoMemoryPath(): string {
  return join(globalMemoryDir(), AUTO_MEMORY_FILENAME);
}

/** Where the auto-config (on/off toggle) JSON lives. */
export function autoMemoryConfigPath(): string {
  return join(MEMORY_ROOT, "auto-config.json");
}

/**
 * Stable cwd handed to the consolidator's one-shot `query()` call.
 * Pinning it (instead of using `tmpdir()`) means the sanitized path
 * the SDK derives from it is deterministic and platform-independent,
 * which lets us:
 *   1. Reliably delete the consolidator's stub session file after each
 *      run (the SDK still creates one even with `persistSession: false`).
 *   2. Sweep the same directory clean at server boot to clear orphans
 *      from crashes or pre-fix runs.
 *
 * Hidden under `/root/.memory/.consolidator-cwd/` so the file browser
 * doesn't surface it and Claude never reads it as a project.
 */
export function consolidatorCwd(): string {
  return join(MEMORY_ROOT, ".consolidator-cwd");
}

/**
 * `~/.claude/projects/<sanitized(consolidatorCwd)>/` — where the SDK
 * writes the consolidator's stub session JSONLs. We delete inside this
 * dir on every run + at boot.
 */
export function consolidatorClaudeProjectsDir(): string {
  return join(homedir(), ".claude", "projects", sanitizeCwdForClaude(consolidatorCwd()));
}

/**
 * Basename of `consolidatorClaudeProjectsDir()` — the single segment
 * the `/api/sessions*` routes compare against when walking
 * `~/.claude/projects/` so the consolidator's transient stub session
 * never appears in the sidebar as an empty "New conversation".
 */
export function consolidatorProjectDirName(): string {
  return sanitizeCwdForClaude(consolidatorCwd());
}

/** Create the consolidator cwd if missing. Called once at boot. */
export async function ensureConsolidatorCwd(): Promise<void> {
  const dir = consolidatorCwd();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/** Directory holding global memory `.md` files. */
export function globalMemoryDir(): string {
  return join(MEMORY_ROOT, "global");
}

/**
 * Sanitize a cwd into the directory-name shape the Claude Agent SDK uses
 * for both transcripts and auto-memory: every non-`[A-Za-z0-9-]` char
 * becomes `-`. Verified against live install:
 *   /root/projects/test/claw-ops-chat → -root-projects-test-claw-ops-chat
 *   /root/.memory/.consolidator-cwd   → -root--memory--consolidator-cwd
 * The earlier `/`-only replacement missed dot-prefixed segments, which
 * broke the consolidator's boot sweep + per-run cleanup (they pointed
 * at a directory that never existed under that name), letting stub
 * JSONLs accumulate indefinitely.
 */
export function sanitizeCwdForClaude(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9-]/g, "-");
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
