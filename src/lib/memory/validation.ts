import { MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "./paths";

/**
 * Pure validation helpers for memory file paths. Lives in its own module
 * so client bundles can import these without pulling in `fs`/`os`.
 */

/**
 * Filesystem-safe relative memory path. Lowercase alphanumeric + `-` /
 * `_` segments separated by `/`, ending in `.md`. Each segment must
 * start with an alphanumeric (rejects dotfiles). 1–256 chars total.
 *
 * Rejects by construction:
 *   - `..` traversal
 *   - leading `/` (absolute paths)
 *   - null bytes
 *   - dotfiles (`.foo`)
 *   - non-`.md` extensions
 *   - Windows separators (`\`)
 */
export const MEMORY_PATH_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*\.md$/;

const MAX_PATH_LEN = 256;

export class MemoryValidationError extends Error {
  constructor(
    message: string,
    /** HTTP-friendly status code for the API layer. */
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "MemoryValidationError";
  }
}

/**
 * Validate a relative memory path. Throws on failure so callers can rely
 * on the path being safe to `join()` against a base directory.
 */
export function assertMemoryRelPath(p: unknown): void {
  if (typeof p !== "string") {
    throw new MemoryValidationError("Memory path must be a string");
  }
  if (p.length === 0 || p.length > MAX_PATH_LEN) {
    throw new MemoryValidationError("Memory path length out of range");
  }
  if (p.includes("\0")) {
    throw new MemoryValidationError("Memory path contains null byte");
  }
  if (!MEMORY_PATH_RE.test(p)) {
    throw new MemoryValidationError(
      "Memory path must look like 'name.md' or 'sub/name.md' " +
        "(lowercase letters, digits, '-', '_'; ends with .md)",
    );
  }
}

export interface MemoryContentValidation {
  ok: boolean;
  /** Status the API should return when `ok === false`. */
  status?: number;
  /** Human-readable error, present iff `ok === false`. */
  error?: string;
}

/**
 * Validate a write against the per-file and per-scope caps. Caller passes
 * the current sum of bytes already on disk in this scope (excluding the
 * file being written, since an update replaces existing bytes).
 */
export function validateMemoryContent(
  content: string,
  bytesAlreadyInScope: number,
): MemoryContentValidation {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_FILE_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `File exceeds per-file cap of ${MAX_FILE_BYTES} bytes`,
    };
  }
  if (bytesAlreadyInScope + bytes > MAX_TOTAL_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Write would exceed total cap of ${MAX_TOTAL_BYTES} bytes for this scope`,
    };
  }
  return { ok: true };
}
