import { createHash } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { extFromMime } from "../mime";

/**
 * Disk cache for proxied external images. Key is sha256(url) → binary
 * file + a sidecar .meta.json with the stored Content-Type.
 *
 * - TTL 7d: older entries are purged.
 * - Soft cap 1 GB total: LRU-trimmed during purge.
 */

export const IMAGE_CACHE_ROOT = "/root/.cache/images";

const IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024; // 1 GB

interface CachedImage {
  bytes: Uint8Array;
  contentType: string;
}

function keyFor(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function binPath(url: string, ext: string): string {
  return join(IMAGE_CACHE_ROOT, `${keyFor(url)}.${ext}`);
}

function metaPath(url: string): string {
  return join(IMAGE_CACHE_ROOT, `${keyFor(url)}.meta.json`);
}

async function ensureRoot(): Promise<void> {
  if (!existsSync(IMAGE_CACHE_ROOT)) {
    await mkdir(IMAGE_CACHE_ROOT, { recursive: true });
  }
}

/** Read a cached image. Returns null on miss or expiry. */
export async function readImage(url: string): Promise<CachedImage | null> {
  const meta = metaPath(url);
  if (!existsSync(meta)) return null;
  try {
    const raw = await readFile(meta, "utf-8");
    const info = JSON.parse(raw) as {
      at: number;
      contentType: string;
      ext: string;
    };
    if (Date.now() - info.at > IMAGE_TTL_MS) return null;
    const bin = binPath(url, info.ext);
    if (!existsSync(bin)) return null;
    const bytes = await readFile(bin);
    return { bytes: new Uint8Array(bytes), contentType: info.contentType };
  } catch {
    return null;
  }
}

/** Write an image + meta sidecar. */
export async function writeImage(
  url: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  try {
    await ensureRoot();
    const ext = extFromMime(contentType);
    const bin = binPath(url, ext);
    const meta = metaPath(url);
    const binTmp = `${bin}.tmp`;
    const metaTmp = `${meta}.tmp`;
    await writeFile(binTmp, bytes);
    await rename(binTmp, bin);
    await writeFile(metaTmp, JSON.stringify({ at: Date.now(), contentType, ext }), "utf-8");
    await rename(metaTmp, meta);
  } catch {
    /* best-effort cache */
  }
}

/** Delete expired entries and LRU-trim if total size exceeds MAX_TOTAL_BYTES. */
export async function purgeOldImages(): Promise<{ deleted: number; bytesFreed: number }> {
  if (!existsSync(IMAGE_CACHE_ROOT)) return { deleted: 0, bytesFreed: 0 };
  const entries = await readdir(IMAGE_CACHE_ROOT).catch(() => [] as string[]);
  const now = Date.now();
  const alive: Array<{ base: string; size: number; mtime: number; files: string[] }> = [];
  let deleted = 0;
  let bytesFreed = 0;

  // Group by cache key (each entry has a .meta.json sidecar + one binary file).
  const groups = new Map<string, { meta?: string; bin?: string }>();
  for (const name of entries) {
    const dot = name.indexOf(".");
    if (dot < 0) continue;
    const base = name.slice(0, dot);
    const group = groups.get(base) ?? {};
    if (name.endsWith(".meta.json")) group.meta = name;
    else group.bin = name;
    groups.set(base, group);
  }

  for (const [base, { meta, bin }] of groups) {
    if (!meta || !bin) {
      // Orphan: delete whatever's there.
      for (const f of [meta, bin].filter(Boolean) as string[]) {
        const full = join(IMAGE_CACHE_ROOT, f);
        try {
          const s = await stat(full);
          await unlink(full);
          deleted += 1;
          bytesFreed += s.size;
        } catch {
          /* skip */
        }
      }
      continue;
    }
    const metaFull = join(IMAGE_CACHE_ROOT, meta);
    const binFull = join(IMAGE_CACHE_ROOT, bin);
    try {
      const metaStat = await stat(metaFull);
      const binStat = await stat(binFull);
      if (now - metaStat.mtimeMs > IMAGE_TTL_MS) {
        await unlink(metaFull);
        await unlink(binFull);
        deleted += 1;
        bytesFreed += metaStat.size + binStat.size;
      } else {
        alive.push({
          base,
          size: metaStat.size + binStat.size,
          mtime: metaStat.mtimeMs,
          files: [meta, bin],
        });
      }
    } catch {
      /* skip */
    }
  }

  // LRU trim if over cap.
  let totalAlive = alive.reduce((acc, e) => acc + e.size, 0);
  if (totalAlive > MAX_TOTAL_BYTES) {
    alive.sort((a, b) => a.mtime - b.mtime);
    for (const entry of alive) {
      if (totalAlive <= MAX_TOTAL_BYTES) break;
      for (const f of entry.files) {
        try {
          await unlink(join(IMAGE_CACHE_ROOT, f));
        } catch {
          /* skip */
        }
      }
      totalAlive -= entry.size;
      bytesFreed += entry.size;
      deleted += 1;
    }
  }

  return { deleted, bytesFreed };
}
