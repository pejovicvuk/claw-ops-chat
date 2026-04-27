import { existsSync } from "fs";
import { readdir, stat, unlink } from "fs/promises";
import { join } from "path";
import type { AutomationActionFn } from "../types";

const SNAPSHOT_DIR = "/root/.monitoring/heap-snapshots";

/**
 * Deletes heap snapshot files older than `options.maxAgeDays`. They are
 * large (tens of MB each) and only useful for debugging recent memory
 * issues, so a 14-day default is plenty.
 */
export const trimHeapSnapshots: AutomationActionFn = async (ctx) => {
  if (!existsSync(SNAPSHOT_DIR)) {
    return { ok: true, summary: "No heap snapshots directory yet (nothing to do)" };
  }
  const days = typeof ctx.rule.options.maxAgeDays === "number" ? ctx.rule.options.maxAgeDays : 14;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let bytesFreed = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(SNAPSHOT_DIR);
  } catch {
    return { ok: true, summary: "Snapshot directory unreadable" };
  }
  for (const name of entries) {
    if (!name.endsWith(".heapsnapshot")) continue;
    const full = join(SNAPSHOT_DIR, name);
    try {
      const s = await stat(full);
      if (s.mtimeMs > cutoff) continue;
      bytesFreed += s.size;
      await unlink(full);
      deleted += 1;
    } catch {
      /* race; skip */
    }
  }
  return {
    ok: true,
    summary: `Deleted ${deleted} heap snapshot(s) older than ${days} day${days === 1 ? "" : "s"}, freed ${(bytesFreed / (1024 * 1024)).toFixed(1)} MB`,
    details: { deleted, bytesFreed, days },
  };
};
