import { createHash } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "fs/promises";
import { join } from "path";
import type { UnfurlData } from "./unfurl-parser";

/**
 * Disk cache for parsed unfurl results. Key is sha256(url) → JSON file.
 *
 * - TTL 24h: anything older is ignored on read and deleted on purge.
 * - Soft cap of 10k entries: LRU-trimmed during purge (oldest mtime wins).
 * - Atomic writes via temp+rename so a concurrent read never sees a half-written file.
 */

export const UNFURL_CACHE_ROOT = "/root/.cache/unfurls";

const UNFURL_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 10_000;

interface CacheEntry {
  at: number;
  data: UnfurlData;
}

function keyFor(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function pathFor(url: string): string {
  return join(UNFURL_CACHE_ROOT, `${keyFor(url)}.json`);
}

async function ensureRoot(): Promise<void> {
  if (!existsSync(UNFURL_CACHE_ROOT)) {
    await mkdir(UNFURL_CACHE_ROOT, { recursive: true });
  }
}

/** Read a cached unfurl. Returns null on miss or expiry. */
export async function readUnfurl(url: string): Promise<UnfurlData | null> {
  const path = pathFor(url);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    const entry = JSON.parse(raw) as CacheEntry;
    if (!entry || typeof entry.at !== "number") return null;
    if (Date.now() - entry.at > UNFURL_TTL_MS) return null;
    return entry.data;
  } catch {
    return null;
  }
}

/** Write an unfurl to cache. Fire-and-forget; errors are swallowed. */
export async function writeUnfurl(url: string, data: UnfurlData): Promise<void> {
  try {
    await ensureRoot();
    const path = pathFor(url);
    const entry: CacheEntry = { at: Date.now(), data };
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(entry), "utf-8");
    await rename(tmp, path);
  } catch {
    /* best-effort cache */
  }
}

/** Delete expired entries and LRU-trim if over MAX_ENTRIES. */
export async function purgeOldUnfurls(): Promise<{ deleted: number }> {
  if (!existsSync(UNFURL_CACHE_ROOT)) return { deleted: 0 };
  const entries = await readdir(UNFURL_CACHE_ROOT).catch(() => [] as string[]);
  const now = Date.now();
  const withStat: Array<{ name: string; mtime: number }> = [];
  let deleted = 0;
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const full = join(UNFURL_CACHE_ROOT, name);
    try {
      const s = await stat(full);
      if (now - s.mtimeMs > UNFURL_TTL_MS) {
        await unlink(full);
        deleted += 1;
      } else {
        withStat.push({ name, mtime: s.mtimeMs });
      }
    } catch {
      /* skip */
    }
  }
  if (withStat.length > MAX_ENTRIES) {
    withStat.sort((a, b) => a.mtime - b.mtime); // oldest first
    const over = withStat.slice(0, withStat.length - MAX_ENTRIES);
    for (const { name } of over) {
      try {
        await unlink(join(UNFURL_CACHE_ROOT, name));
        deleted += 1;
      } catch {
        /* skip */
      }
    }
  }
  return { deleted };
}
