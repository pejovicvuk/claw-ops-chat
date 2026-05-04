import pidusage from "pidusage";
import { getBrowserPid } from "@/lib/preview-stream/chromium-pool";
import { getActivePreviews, previewMaxActive } from "@/lib/preview-stream/health";
import { RingBuffer } from "../ring-buffer";
import type { PreviewsSnapshot } from "../types";

/**
 * Phase 6a (#134) preview metrics collector. Reads the in-memory preview
 * registry maintained by `preview-stream/health.ts` and reports:
 *
 *   - active count + cap (`PREVIEW_MAX_ACTIVE`)
 *   - Chromium browser-process CPU + RSS via `pidusage` (shared across
 *     all previews — Chromium pages are renderer subprocesses, but we
 *     deliberately surface the *aggregate* so operators can spot
 *     runaway preview load without trying to attribute it per-tab)
 *   - per-preview frame / byte / restart counters and last heartbeat
 *
 * Cadence: 5 s (the start config in `MetricsCollector`). pidusage is a
 * lightweight /proc read on Linux but still costs a syscall, so we run
 * it slower than the 1 s health collector.
 */

const SERIES_LEN = 60;
let activeSeries: RingBuffer | null = null;

function ensureBuffer(): RingBuffer {
  if (!activeSeries) activeSeries = new RingBuffer(SERIES_LEN);
  return activeSeries;
}

export async function collectPreviews(): Promise<PreviewsSnapshot> {
  const items = getActivePreviews();
  const buf = ensureBuffer();
  buf.push(items.length);

  let chromiumCpu: number | null = null;
  let chromiumMem: number | null = null;
  const pid = getBrowserPid();
  if (pid !== null) {
    try {
      const stats = await pidusage(pid);
      chromiumCpu = typeof stats.cpu === "number" ? stats.cpu : null;
      chromiumMem = typeof stats.memory === "number" ? stats.memory : null;
    } catch {
      /* The browser may have been reaped between getBrowserPid() and the
         pidusage call. Returning null is preferable to bubbling an error
         up to the collector's error log on every tick. */
    }
  }

  let totalFramesSent = 0;
  let totalBytesSent = 0;
  let totalRestartCount = 0;
  for (const i of items) {
    totalFramesSent += i.framesSent;
    totalBytesSent += i.bytesSent;
    totalRestartCount += i.restartCount;
  }

  return {
    active: items.length,
    maxActive: previewMaxActive(),
    totalFramesSent,
    totalBytesSent,
    totalRestartCount,
    chromium: {
      pid,
      cpuPct: chromiumCpu,
      memBytes: chromiumMem,
    },
    series: {
      active: buf.toArray(),
    },
    items,
  };
}
