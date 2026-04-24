import { existsSync } from "fs";
import { readdir, stat, unlink } from "fs/promises";
import { join } from "path";
import { AUDIT_CATEGORIES, RETENTION_MS, categoryDir, parseDailyFileName } from "./paths";
import { readAuditMeta, writeAuditMeta } from "./writer";
import type { AuditCategory } from "./types";

export interface PurgeResult {
  deleted: string[];
  bytesFreed: number;
}

/**
 * Delete daily audit files older than `maxAgeMs`. Defaults to the 30-day
 * retention window (RETENTION_MS). Optional `categoryFilter` scopes the
 * purge to one of api / cron / session (used by the "Delete logs older
 * than… in Category X" UI action).
 *
 * `maxAgeMs: 0` deletes everything in the selected categories — used by
 * the "Delete everything" UI action with a typed-confirm modal.
 *
 * Idempotent: called at boot + every 6 hours + on manual trigger.
 */
export async function purgeOldAuditFiles(
  maxAgeMs: number = RETENTION_MS,
  categoryFilter?: AuditCategory,
): Promise<PurgeResult> {
  const cutoff = Date.now() - maxAgeMs;
  const categories = categoryFilter ? [categoryFilter] : [...AUDIT_CATEGORIES];
  const result: PurgeResult = { deleted: [], bytesFreed: 0 };

  // maxAgeMs=0 is the "nuke everything" path (UI "Delete everything"
  // button with typed-confirm). Skip the 24h safety buffer below so
  // today's file is also removed.
  const nukeAll = maxAgeMs <= 0;

  for (const cat of categories) {
    const dir = categoryDir(cat);
    if (!existsSync(dir)) continue;
    const entries = await readdir(dir).catch(() => [] as string[]);
    for (const name of entries) {
      const fileDate = parseDailyFileName(name);
      if (fileDate === null) continue;
      if (!nukeAll) {
        // Keep files whose start-of-day is >= cutoff (fileDate is 00:00
        // UTC for that day, so a file is "fully past retention" only
        // when its *end* of day is older than cutoff — add 24h to be
        // safe).
        const fileEnd = fileDate + 24 * 60 * 60 * 1000;
        if (fileEnd > cutoff) continue;
      }
      const fullPath = join(dir, name);
      try {
        const s = await stat(fullPath);
        await unlink(fullPath);
        result.deleted.push(`${cat}/${name}`);
        result.bytesFreed += s.size;
      } catch {
        /* concurrent delete or stat race — skip */
      }
    }
  }

  // Update .meta.json with purge bookkeeping.
  try {
    const meta = await readAuditMeta();
    meta.lastPurgeAt = Date.now();
    meta.lastPurgeCount = result.deleted.length;
    await writeAuditMeta(meta);
  } catch {
    /* meta update is best-effort */
  }

  if (result.deleted.length > 0) {
    console.log(
      `[audit] purged ${result.deleted.length} file(s), ${result.bytesFreed} bytes freed`,
    );
  }

  return result;
}
