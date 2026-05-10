import { mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import type { Dirent } from "fs";
import { dirname, join, relative, sep } from "path";

import { MemoryValidationError, assertMemoryRelPath, validateMemoryContent } from "./validation";

/**
 * CRUD for memory `.md` files rooted at a passed-in base directory.
 *
 * Path safety: every relative path goes through `assertMemoryRelPath`
 * before being joined to the base. The regex rejects `..`, leading `/`,
 * null bytes, dotfiles, and Windows separators — so the resulting
 * `join(base, rel)` cannot escape the base. This mirrors the same trick
 * `src/lib/projects/store.ts` uses with `assertProjectSlug`.
 */

export interface MemoryFile {
  /** Relative path under the base, e.g. "notes.md" or "progress/today.md". */
  path: string;
  size: number;
  /** Epoch ms. */
  updatedAt: number;
  /** First ~200 chars of content, whitespace-collapsed. */
  preview: string;
}

export interface MemoryFileRecord {
  path: string;
  content: string;
  size: number;
  updatedAt: number;
}

const PREVIEW_LEN = 200;

function makePreview(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, PREVIEW_LEN);
}

/**
 * Recursively list every `.md` file under `baseDir`, returning paths
 * relative to it. Returns an empty array when the base does not exist.
 */
export async function listMemoryFiles(baseDir: string): Promise<MemoryFile[]> {
  const out: MemoryFile[] = [];
  await walk(baseDir, baseDir, out);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

async function walk(baseDir: string, dir: string, out: MemoryFile[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(baseDir, abs, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    let st;
    try {
      st = await stat(abs);
    } catch {
      continue;
    }
    let content = "";
    try {
      content = await readFile(abs, "utf-8");
    } catch {
      /* leave preview empty */
    }
    out.push({
      // Always emit POSIX-style separators, regardless of host OS, so the
      // value round-trips through `assertMemoryRelPath` unchanged.
      path: relative(baseDir, abs).split(sep).join("/"),
      size: st.size,
      updatedAt: st.mtimeMs,
      preview: makePreview(content),
    });
  }
}

/** Sum of file sizes under `baseDir`. Used for total-cap enforcement. */
export async function totalMemoryBytes(baseDir: string): Promise<number> {
  const files = await listMemoryFiles(baseDir);
  return files.reduce((acc, f) => acc + f.size, 0);
}

export async function readMemoryFile(baseDir: string, relPath: string): Promise<MemoryFileRecord> {
  assertMemoryRelPath(relPath);
  const abs = join(baseDir, relPath);
  let st;
  try {
    st = await stat(abs);
  } catch {
    throw new MemoryValidationError("Memory file not found", 404);
  }
  if (!st.isFile()) {
    throw new MemoryValidationError("Memory path is not a file", 400);
  }
  const content = await readFile(abs, "utf-8");
  return { path: relPath, content, size: st.size, updatedAt: st.mtimeMs };
}

/**
 * Create or overwrite a memory file. Enforces both caps: the file's own
 * size cap and the total-bytes-in-scope cap.
 */
export async function writeMemoryFile(
  baseDir: string,
  relPath: string,
  content: string,
): Promise<MemoryFileRecord> {
  assertMemoryRelPath(relPath);

  // Existing size of *this* file is excluded from the total so that an
  // update isn't double-counted against its own previous bytes.
  let existingBytes = 0;
  try {
    existingBytes = (await stat(join(baseDir, relPath))).size;
  } catch {
    /* new file */
  }
  const total = await totalMemoryBytes(baseDir);
  const validation = validateMemoryContent(content, total - existingBytes);
  if (!validation.ok) {
    throw new MemoryValidationError(
      validation.error ?? "Invalid content",
      validation.status ?? 400,
    );
  }

  const abs = join(baseDir, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf-8");
  const st = await stat(abs);
  return { path: relPath, content, size: st.size, updatedAt: st.mtimeMs };
}

/**
 * Delete a memory file. No-op if missing. Removes empty parent
 * directories up to (but not including) `baseDir` so that nesting added
 * by a subpath write doesn't leave behind ghost folders.
 */
export async function deleteMemoryFile(baseDir: string, relPath: string): Promise<void> {
  assertMemoryRelPath(relPath);
  const abs = join(baseDir, relPath);
  await rm(abs, { force: true });
  // Best-effort empty-parent cleanup. `rmdir` fails on non-empty dirs,
  // which is exactly the stop condition we want.
  let parent = dirname(abs);
  while (parent !== baseDir && parent.startsWith(baseDir + sep)) {
    try {
      await rm(parent, { recursive: false });
    } catch {
      break;
    }
    parent = dirname(parent);
  }
}
