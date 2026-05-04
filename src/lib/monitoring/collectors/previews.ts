import { readdir, readFile } from "node:fs/promises";
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
 *   - Chromium aggregate CPU + RSS across the browser parent AND every
 *     renderer / GPU / utility subprocess. Multi-process Chromium puts
 *     the *actual* page-rendering load in renderer pids, so reporting
 *     just the parent badly undercounts under multi-tab load. We walk
 *     the browser's process tree via /proc/<pid>/task/<tid>/children,
 *     then pass the union to `pidusage` in one batched call.
 *   - per-preview frame / byte / restart counters and last heartbeat
 *
 * Cadence: 5 s (the start config in `MetricsCollector`). The /proc
 * walk + pidusage call together is a few ms — comfortable inside the
 * 5 s budget.
 *
 * Non-Linux fallback: if /proc isn't available we sample only the
 * parent pid. Production runs on Alpine Linux so this is purely a
 * developer-machine convenience.
 */

const SERIES_LEN = 60;
const PROC_AVAILABLE = process.platform === "linux";
let activeSeries: RingBuffer | null = null;

function ensureBuffer(): RingBuffer {
  if (!activeSeries) activeSeries = new RingBuffer(SERIES_LEN);
  return activeSeries;
}

/**
 * Walk a process tree on Linux by chasing `/proc/<pid>/task/<tid>/children`
 * (each is a space-separated list of immediate child pids). BFS bounded
 * to MAX_NODES so a runaway tree can't stall the collector tick.
 */
async function getDescendantPids(rootPid: number): Promise<number[]> {
  const MAX_NODES = 256;
  const seen = new Set<number>([rootPid]);
  const queue: number[] = [rootPid];
  while (queue.length > 0 && seen.size < MAX_NODES) {
    const pid = queue.shift();
    if (pid === undefined) break;
    const taskDir = `/proc/${pid}/task`;
    let tids: string[];
    try {
      tids = await readdir(taskDir);
    } catch {
      // Process may have died between enqueue and now — skip.
      continue;
    }
    for (const tid of tids) {
      let raw: string;
      try {
        raw = await readFile(`${taskDir}/${tid}/children`, "utf-8");
      } catch {
        continue;
      }
      for (const tok of raw.trim().split(/\s+/)) {
        if (!tok) continue;
        const cpid = Number.parseInt(tok, 10);
        if (!Number.isFinite(cpid) || seen.has(cpid)) continue;
        seen.add(cpid);
        queue.push(cpid);
        if (seen.size >= MAX_NODES) break;
      }
      if (seen.size >= MAX_NODES) break;
    }
  }
  return Array.from(seen);
}

interface PidusageRow {
  cpu: number;
  memory: number;
}

async function aggregateBrowserStats(rootPid: number): Promise<{
  cpuPct: number | null;
  memBytes: number | null;
}> {
  const pids = PROC_AVAILABLE ? await getDescendantPids(rootPid) : [rootPid];
  try {
    // pidusage accepts an array and returns a `{ [pid]: row }` map.
    // Passing one pid returns a single row directly, so normalise.
    const raw = (await pidusage(pids)) as PidusageRow | Record<string, PidusageRow>;
    let cpuSum = 0;
    let memSum = 0;
    let any = false;
    if (pids.length === 1 && "cpu" in raw && typeof (raw as PidusageRow).cpu === "number") {
      const single = raw as PidusageRow;
      cpuSum = single.cpu;
      memSum = single.memory;
      any = true;
    } else {
      for (const row of Object.values(raw as Record<string, PidusageRow>)) {
        if (!row || typeof row.cpu !== "number") continue;
        cpuSum += row.cpu;
        memSum += row.memory;
        any = true;
      }
    }
    return any ? { cpuPct: cpuSum, memBytes: memSum } : { cpuPct: null, memBytes: null };
  } catch {
    // The browser (or some children) may have been reaped between the
    // /proc walk and the pidusage call. Returning null is preferable to
    // bubbling an error up to the collector's error log on every tick.
    return { cpuPct: null, memBytes: null };
  }
}

export async function collectPreviews(): Promise<PreviewsSnapshot> {
  const items = getActivePreviews();
  const buf = ensureBuffer();
  buf.push(items.length);

  let chromiumCpu: number | null = null;
  let chromiumMem: number | null = null;
  const pid = getBrowserPid();
  if (pid !== null) {
    const stats = await aggregateBrowserStats(pid);
    chromiumCpu = stats.cpuPct;
    chromiumMem = stats.memBytes;
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

/** Test-only: reset ring buffer between cases. */
export function _resetForTests(): void {
  activeSeries = null;
}

export const __INTERNAL = { getDescendantPids };
