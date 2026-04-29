import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

/**
 * Server-only paths and constants for the Projects feature. Mirrors the
 * shape of `src/lib/reports/paths.ts` so the layout lives in one file.
 *
 * Pure validation lives in `./validation.ts` so the client bundle can
 * pick it up without dragging `fs` / `os` into the browser.
 */

/** Root directory holding every project folder. Override with PROJECTS_ROOT. */
export const PROJECTS_ROOT: string = process.env.PROJECTS_ROOT || join(homedir(), "projects");

/** Sidecar metadata file inside each project folder. */
export const PROJECT_META_FILENAME = ".project.json";

/** Schema version persisted in `.project.json` so future migrations are tractable. */
export const PROJECT_META_VERSION = 1;

/** Path to a project's folder. Caller must validate slug. */
export function projectDir(slug: string): string {
  return join(PROJECTS_ROOT, slug);
}

/** Path to a project's metadata sidecar. Caller must validate slug. */
export function projectMetaPath(slug: string): string {
  return join(PROJECTS_ROOT, slug, PROJECT_META_FILENAME);
}

/**
 * Create the projects root directory if it doesn't exist. Called once at
 * server boot. Idempotent — safe to call on every restart.
 */
export async function ensureProjectsTree(): Promise<void> {
  if (!existsSync(PROJECTS_ROOT)) {
    await mkdir(PROJECTS_ROOT, { recursive: true });
  }
}
