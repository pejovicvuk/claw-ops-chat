import type { AutomationActionFn } from "../types";

/**
 * Calls `globalThis.gc()` if Node was started with `--expose-gc`.
 * Reports bytes reclaimed and handles the missing-flag case gracefully.
 */
export const forceGcOnThreshold: AutomationActionFn = async () => {
  if (typeof globalThis.gc !== "function") {
    return {
      ok: false,
      summary: "Force GC unavailable (start node with --expose-gc to enable)",
    };
  }
  const before = process.memoryUsage().rss;
  globalThis.gc();
  const after = process.memoryUsage().rss;
  const freed = before - after;
  return {
    ok: true,
    summary: `Force-GC freed ${(freed / (1024 * 1024)).toFixed(1)} MB`,
    details: { freedBytes: freed, rssBefore: before, rssAfter: after },
  };
};
