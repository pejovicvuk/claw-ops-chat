import { monitorEventLoopDelay, performance, PerformanceObserver } from "perf_hooks";
import { RingBuffer } from "../ring-buffer";
import { TimeSeriesBuffer } from "../timeseries-buffer";
import type { HealthSnapshot } from "../types";

const SERIES_LEN = 60;
/** 1h × 1Hz at the health tick cadence. ~58KB per buffer. */
const LONG_SERIES_LEN = 3600;

export type HealthLongMetric =
  | "rssBytes"
  | "heapUsedBytes"
  | "heapTotalBytes"
  | "externalBytes"
  | "loopP50Ms"
  | "loopP95Ms"
  | "loopP99Ms"
  | "gcPausesPerMin"
  | "gcTimePerMin";

export interface HealthCollector {
  rssSeries: RingBuffer;
  heapSeries: RingBuffer;
  loopP95Series: RingBuffer;
  gcPauseSeries: RingBuffer;
  /**
   * Long-term timestamped buffers used by the multi-series chart in the
   * Health section (1h history at 1Hz tick cadence).
   */
  longSeries: Record<HealthLongMetric, TimeSeriesBuffer>;
  monitor: ReturnType<typeof monitorEventLoopDelay>;
  startedAtIso: string;
  /** Tracks GC events fired in the trailing 60s. */
  gcWindow: number[];
  /** Total GC duration fired in the trailing 60s. */
  gcDurationWindow: Array<{ at: number; durationMs: number }>;
  /** Last `Major` (full) GC timestamp. */
  lastFullGcAt: number | null;
  observer: PerformanceObserver | null;
  dispose?: () => void;
}

export function createHealthCollector(): HealthCollector {
  const monitor = monitorEventLoopDelay({ resolution: 20 });
  monitor.enable();

  const collector: HealthCollector = {
    rssSeries: new RingBuffer(SERIES_LEN),
    heapSeries: new RingBuffer(SERIES_LEN),
    loopP95Series: new RingBuffer(SERIES_LEN),
    gcPauseSeries: new RingBuffer(SERIES_LEN),
    longSeries: {
      rssBytes: new TimeSeriesBuffer(LONG_SERIES_LEN),
      heapUsedBytes: new TimeSeriesBuffer(LONG_SERIES_LEN),
      heapTotalBytes: new TimeSeriesBuffer(LONG_SERIES_LEN),
      externalBytes: new TimeSeriesBuffer(LONG_SERIES_LEN),
      loopP50Ms: new TimeSeriesBuffer(LONG_SERIES_LEN),
      loopP95Ms: new TimeSeriesBuffer(LONG_SERIES_LEN),
      loopP99Ms: new TimeSeriesBuffer(LONG_SERIES_LEN),
      gcPausesPerMin: new TimeSeriesBuffer(LONG_SERIES_LEN),
      gcTimePerMin: new TimeSeriesBuffer(LONG_SERIES_LEN),
    },
    monitor,
    startedAtIso: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    gcWindow: [],
    gcDurationWindow: [],
    lastFullGcAt: null,
    observer: null,
  };

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const now = Date.now();
        collector.gcWindow.push(now);
        collector.gcDurationWindow.push({ at: now, durationMs: entry.duration });
        // 4 = NODE_PERFORMANCE_GC_MAJOR per perf_hooks docs.
        const kind = (entry as unknown as { detail?: { kind?: number } }).detail?.kind;
        if (kind === 4 || kind === 2) {
          collector.lastFullGcAt = now;
        }
      }
    });
    observer.observe({ entryTypes: ["gc"], buffered: false });
    collector.observer = observer;
    collector.dispose = () => {
      observer.disconnect();
      monitor.disable();
    };
  } catch {
    /* GC observation is best-effort. */
    collector.dispose = () => monitor.disable();
  }

  return collector;
}

export async function collectHealth(c: HealthCollector): Promise<HealthSnapshot> {
  const mem = process.memoryUsage();
  c.rssSeries.push(mem.rss);
  c.heapSeries.push(mem.heapUsed);

  // perf_hooks histograms are in nanoseconds.
  const monitor = c.monitor;
  const lagP50 = monitor.percentile(50) / 1e6;
  const lagP95 = monitor.percentile(95) / 1e6;
  const lagP99 = monitor.percentile(99) / 1e6;
  const lagMax = monitor.max / 1e6;
  monitor.reset();
  c.loopP95Series.push(lagP95);

  const now = Date.now();
  const oneMinAgo = now - 60_000;
  c.gcWindow = c.gcWindow.filter((t) => t >= oneMinAgo);
  c.gcDurationWindow = c.gcDurationWindow.filter((g) => g.at >= oneMinAgo);
  const pausesPerMin = c.gcWindow.length;
  const totalPauseMs = c.gcDurationWindow.reduce((sum, g) => sum + g.durationMs, 0);
  c.gcPauseSeries.push(pausesPerMin);

  // Long-buffer pushes for chart history.
  c.longSeries.rssBytes.push(now, mem.rss);
  c.longSeries.heapUsedBytes.push(now, mem.heapUsed);
  c.longSeries.heapTotalBytes.push(now, mem.heapTotal);
  c.longSeries.externalBytes.push(now, mem.external);
  c.longSeries.loopP50Ms.push(now, lagP50);
  c.longSeries.loopP95Ms.push(now, lagP95);
  c.longSeries.loopP99Ms.push(now, lagP99);
  c.longSeries.gcPausesPerMin.push(now, pausesPerMin);
  c.longSeries.gcTimePerMin.push(now, totalPauseMs);

  const startedAt = c.startedAtIso;

  const result: HealthSnapshot = {
    process: {
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1000),
      nodeVersion: process.version,
      startedAt,
    },
    memory: {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      externalBytes: mem.external,
      arrayBuffersBytes: mem.arrayBuffers,
    },
    eventLoop: {
      lagP50Ms: lagP50,
      lagP95Ms: lagP95,
      lagP99Ms: lagP99,
      lagMaxMs: lagMax,
    },
    gc: {
      pausesPerMin,
      totalPauseMsPerMin: totalPauseMs,
      lastFullGcAt: c.lastFullGcAt,
    },
    series: {
      rssBytes: c.rssSeries.toArray(),
      heapUsedBytes: c.heapSeries.toArray(),
      eventLoopLagP95Ms: c.loopP95Series.toArray(),
      gcPausesPerMin: c.gcPauseSeries.toArray(),
    },
  };
  // Suppress unused 'performance' import warning — kept for future timing hooks.
  void performance;
  return result;
}
