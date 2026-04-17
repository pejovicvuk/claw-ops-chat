import { realpath } from "fs/promises";
import { resolve, basename, sep } from "path";
import { homedir } from "os";

/**
 * Base directory for all file operations.
 * - Production: CLAUDE_CWD env var, or "/workspace" (Docker default).
 * - Development: CLAUDE_CWD env var, or user's home directory (so the file
 *   browser works out of the box on dev machines without extra config).
 */
const dev = process.env.NODE_ENV !== "production";
const BASE_DIR = process.env.CLAUDE_CWD || (dev ? homedir() : "/workspace");

/**
 * Resolves a user-provided file path and validates it stays within the allowed
 * base directory. Prevents path traversal attacks (CWE-22).
 *
 * @param userPath - The raw path from the request
 * @returns The resolved, validated absolute path
 * @throws {SafePathError} if the path escapes the base directory
 */
export async function safePath(userPath: string): Promise<string> {
  let p = userPath;

  // Expand home directory
  if (p.startsWith("~")) {
    p = p.replace("~", homedir());
  }

  // Resolve to absolute path
  p = resolve(p);

  // Attempt realpath to resolve symlinks. If the file doesn't exist yet
  // (e.g., for write operations), we resolve the parent directory instead.
  let resolved: string;
  try {
    resolved = await realpath(p);
  } catch {
    // File may not exist yet — resolve parent directory
    const parent = resolve(p, "..");
    try {
      const resolvedParent = await realpath(parent);
      resolved = resolve(resolvedParent, basename(p));
    } catch {
      // Parent also doesn't exist — use the lexically resolved path
      resolved = p;
    }
  }

  // Validate the resolved path is within the base directory
  const normalizedBase = await getBaseDir();
  if (!resolved.startsWith(normalizedBase + sep) && resolved !== normalizedBase) {
    throw new SafePathError(`Access denied: path is outside the allowed directory`);
  }

  return resolved;
}

/**
 * Sanitizes a filename by stripping path traversal components.
 * Used for uploaded file names to prevent directory escape.
 */
export function safeFilename(name: string): string {
  // Extract only the base filename, stripping any directory components
  return basename(name);
}

export class SafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafePathError";
  }
}

let _resolvedBaseDir: string | null = null;

async function getBaseDir(): Promise<string> {
  if (_resolvedBaseDir) return _resolvedBaseDir;
  try {
    _resolvedBaseDir = await realpath(BASE_DIR);
  } catch {
    _resolvedBaseDir = resolve(BASE_DIR);
  }
  return _resolvedBaseDir;
}
