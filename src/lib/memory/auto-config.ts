import { existsSync } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname } from "path";

import { autoMemoryConfigPath } from "./paths";

/**
 * Persisted user preferences for the auto-collected memory consolidator.
 * Lives next to the memory tree (not in the env) so a UI toggle can
 * flip it without a server restart, and the value survives container
 * rebuilds via the same `/root` bind mount.
 *
 * `AUTO_GLOBAL_MEMORY=0` overrides this file (forces off) — useful as a
 * deploy-time kill switch when you don't want to expose the feature
 * even though the file says enabled.
 */

export interface AutoMemoryConfig {
  /** When false, the consolidator never runs and never writes auto.md. */
  enabled: boolean;
  /** Idle delay before consolidation fires after the last turn ends (ms). */
  idleMs: number;
  /** Last successful consolidation, UTC ms. Null if never run. */
  lastConsolidatedAt: number | null;
}

const DEFAULTS: AutoMemoryConfig = {
  enabled: true,
  idleMs: 60_000,
  lastConsolidatedAt: null,
};

const MIN_IDLE_MS = 5_000;
const MAX_IDLE_MS = 30 * 60_000;

function clampIdleMs(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULTS.idleMs;
  return Math.max(MIN_IDLE_MS, Math.min(MAX_IDLE_MS, Math.floor(n)));
}

function envForcesDisabled(): boolean {
  const raw = process.env.AUTO_GLOBAL_MEMORY;
  if (raw === undefined) return false;
  return /^(0|false|no|off)$/i.test(raw.trim());
}

/**
 * Load the on-disk config. Falls back to defaults on missing or
 * malformed file. The env kill-switch is applied to the returned
 * `enabled` field so callers don't have to remember to check.
 */
export async function loadAutoMemoryConfig(): Promise<AutoMemoryConfig> {
  const path = autoMemoryConfigPath();
  let parsed: Partial<AutoMemoryConfig> = {};
  if (existsSync(path)) {
    try {
      const raw = await readFile(path, "utf-8");
      const candidate: unknown = JSON.parse(raw);
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        parsed = candidate as Partial<AutoMemoryConfig>;
      }
    } catch {
      /* fall through to defaults */
    }
  }
  const enabled = envForcesDisabled()
    ? false
    : typeof parsed.enabled === "boolean"
      ? parsed.enabled
      : DEFAULTS.enabled;
  return {
    enabled,
    idleMs: clampIdleMs(parsed.idleMs ?? DEFAULTS.idleMs),
    lastConsolidatedAt:
      typeof parsed.lastConsolidatedAt === "number" ? parsed.lastConsolidatedAt : null,
  };
}

export interface AutoMemoryConfigPatch {
  enabled?: boolean;
  idleMs?: number;
  lastConsolidatedAt?: number | null;
}

/**
 * Merge a patch into the on-disk config and return the new state.
 * Only callers (the API toggle handler, the consolidator) write here.
 * Atomic write so a partial JSON never lands on disk.
 */
export async function updateAutoMemoryConfig(
  patch: AutoMemoryConfigPatch,
): Promise<AutoMemoryConfig> {
  const current = await loadAutoMemoryConfig();
  const next: AutoMemoryConfig = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    idleMs: patch.idleMs !== undefined ? clampIdleMs(patch.idleMs) : current.idleMs,
    lastConsolidatedAt:
      patch.lastConsolidatedAt === undefined
        ? current.lastConsolidatedAt
        : patch.lastConsolidatedAt,
  };
  const path = autoMemoryConfigPath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2) + "\n", "utf-8");
  await rename(tmp, path);
  return next;
}
