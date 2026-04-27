import { existsSync } from "fs";
import { readdir, stat, unlink } from "fs/promises";
import { join } from "path";
import type { AutomationActionFn } from "../types";

const SERIES_DIR = "/root/.monitoring/series";

/**
 * Trims the (future, opt-in) long-term metrics-history JSONL files
 * under /root/.monitoring/series. Currently unused since long-term
 * persistence isn't enabled by default; included so the rule + cron
 * are wired and ready when that subsystem lands.
 */
export const trimMonitoringHistory: AutomationActionFn = async (ctx) => {
  if (!existsSync(SERIES_DIR)) {
    return {
      ok: true,
      summary: "No long-term metrics history yet (nothing to do)",
    };
  }
  const days = typeof ctx.rule.options.maxAgeDays === "number" ? ctx.rule.options.maxAgeDays : 7;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let bytesFreed = 0;

  // The directory is `series/<topic>/<YYYY-MM-DD>.jsonl`. Walk one level deep.
  let topics: string[] = [];
  try {
    topics = await readdir(SERIES_DIR);
  } catch {
    return { ok: true, summary: "Series directory unreadable" };
  }
  for (const topic of topics) {
    const topicDir = join(SERIES_DIR, topic);
    try {
      const ts = await stat(topicDir);
      if (!ts.isDirectory()) continue;
    } catch {
      continue;
    }
    let files: string[] = [];
    try {
      files = await readdir(topicDir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith(".jsonl")) continue;
      const full = join(topicDir, name);
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
  }
  return {
    ok: true,
    summary: `Deleted ${deleted} metrics-history file(s) older than ${days} day${days === 1 ? "" : "s"}, freed ${(bytesFreed / (1024 * 1024)).toFixed(1)} MB`,
    details: { deleted, bytesFreed, days },
  };
};
