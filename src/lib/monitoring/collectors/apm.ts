import { RingBuffer } from "../ring-buffer";
import type { ApmRouteRow, ApmSlowOpRow, ApmSnapshot } from "../types";

const SERIES_LEN = 60;
const ROUTE_WINDOW_MS = 5 * 60 * 1000;
const MAX_SLOW_OPS = 50;
const SLOW_OP_THRESHOLD_MS = 250;
/** Latency band edges (ms). Buckets are closed at the upper bound. */
const LATENCY_BANDS = [10, 50, 100, 250, 500, 1000, 5000, Infinity];
const HEATMAP_TIME_BUCKETS = 60;

interface RouteSample {
  at: number;
  durationMs: number;
  isError: boolean;
}

export interface ApmCollector {
  /** Per-route rolling window of samples. */
  routeSamples: Map<string, RouteSample[]>;
  /** Recent slow operations. */
  slowOps: ApmSlowOpRow[];
  /** Series ring buffers — populated on each tick. */
  rpmSeries: RingBuffer;
  p50Series: RingBuffer;
  p95Series: RingBuffer;
  p99Series: RingBuffer;
  /** Heatmap matrix [latency band][time bucket]. */
  heatmap: number[][];
  heatmapAt: number;
  /** SDK turn samples. */
  sdkTurnSamples: number[];
  sdkTurnPerMinSeries: RingBuffer;
  sdkTurnsThisMinute: number[];
  dispose?: () => void;
}

export function createApmCollector(): ApmCollector {
  const heatmap = new Array(LATENCY_BANDS.length)
    .fill(null)
    .map(() => new Array<number>(HEATMAP_TIME_BUCKETS).fill(0));
  return {
    routeSamples: new Map(),
    slowOps: [],
    rpmSeries: new RingBuffer(SERIES_LEN),
    p50Series: new RingBuffer(SERIES_LEN),
    p95Series: new RingBuffer(SERIES_LEN),
    p99Series: new RingBuffer(SERIES_LEN),
    heatmap,
    heatmapAt: Math.floor(Date.now() / 60_000),
    sdkTurnSamples: [],
    sdkTurnPerMinSeries: new RingBuffer(SERIES_LEN),
    sdkTurnsThisMinute: [],
  };
}

/** Public API used by the withApm middleware. */
export function recordRequest(
  apm: ApmCollector,
  args: {
    route: string;
    method: string;
    durationMs: number;
    statusCode: number;
    actor: string;
  },
): void {
  const key = `${args.method} ${args.route}`;
  const arr = apm.routeSamples.get(key) ?? [];
  arr.push({ at: Date.now(), durationMs: args.durationMs, isError: args.statusCode >= 400 });
  // Aggressive purge when array gets large.
  if (arr.length > 5000) {
    const cutoff = Date.now() - ROUTE_WINDOW_MS;
    const trimmed = arr.filter((s) => s.at >= cutoff);
    apm.routeSamples.set(key, trimmed);
  } else {
    apm.routeSamples.set(key, arr);
  }

  // Heatmap: figure out which latency band + time bucket.
  const bandIdx = LATENCY_BANDS.findIndex((b) => args.durationMs <= b);
  const bucketIdx = Math.floor(Date.now() / 60_000) % HEATMAP_TIME_BUCKETS;
  apm.heatmap[bandIdx >= 0 ? bandIdx : LATENCY_BANDS.length - 1][bucketIdx] += 1;

  if (args.durationMs >= SLOW_OP_THRESHOLD_MS) {
    apm.slowOps.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      route: args.route,
      method: args.method,
      durationMs: args.durationMs,
      statusCode: args.statusCode,
      actor: args.actor,
    });
    if (apm.slowOps.length > MAX_SLOW_OPS) apm.slowOps.length = MAX_SLOW_OPS;
  }
}

export function recordSdkTurn(apm: ApmCollector, durationMs: number): void {
  apm.sdkTurnSamples.push(durationMs);
  if (apm.sdkTurnSamples.length > 1000) apm.sdkTurnSamples.shift();
  apm.sdkTurnsThisMinute.push(Date.now());
}

export async function collectApm(apm: ApmCollector): Promise<ApmSnapshot> {
  const now = Date.now();
  const cutoff = now - ROUTE_WINDOW_MS;

  // Trim windows + collect overall samples.
  let allCalls = 0;
  let allErrors = 0;
  const allDurations: number[] = [];
  const errorsByRoute = new Map<string, number>();
  const routeRows: ApmRouteRow[] = [];

  for (const [key, samples] of apm.routeSamples) {
    const trimmed = samples.filter((s) => s.at >= cutoff);
    apm.routeSamples.set(key, trimmed);
    if (trimmed.length === 0) {
      apm.routeSamples.delete(key);
      continue;
    }
    const [method, ...routeParts] = key.split(" ");
    const route = routeParts.join(" ");
    const durations = trimmed.map((s) => s.durationMs);
    const errors = trimmed.filter((s) => s.isError).length;
    allCalls += trimmed.length;
    allErrors += errors;
    for (const d of durations) allDurations.push(d);
    if (errors > 0) errorsByRoute.set(route, errors);
    routeRows.push({
      route,
      method,
      calls: trimmed.length,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
      errorRate: trimmed.length > 0 ? (errors / trimmed.length) * 100 : 0,
    });
  }

  routeRows.sort((a, b) => b.calls - a.calls);

  const rpm = (allCalls / ROUTE_WINDOW_MS) * 60_000;
  const errorRate = allCalls > 0 ? (allErrors / allCalls) * 100 : 0;
  const p50 = percentile(allDurations, 0.5);
  const p95 = percentile(allDurations, 0.95);
  const p99 = percentile(allDurations, 0.99);

  apm.rpmSeries.push(rpm);
  apm.p50Series.push(p50);
  apm.p95Series.push(p95);
  apm.p99Series.push(p99);

  // SDK turns/minute.
  const oneMinAgo = now - 60_000;
  apm.sdkTurnsThisMinute = apm.sdkTurnsThisMinute.filter((t) => t >= oneMinAgo);
  apm.sdkTurnPerMinSeries.push(apm.sdkTurnsThisMinute.length);

  return {
    summary: { rpm, errorRate, p50Ms: p50, p95Ms: p95, p99Ms: p99 },
    series: {
      rpm: apm.rpmSeries.toArray(),
      p50Ms: apm.p50Series.toArray(),
      p95Ms: apm.p95Series.toArray(),
      p99Ms: apm.p99Series.toArray(),
    },
    routes: routeRows.slice(0, 50),
    errorsByRoute: Array.from(errorsByRoute.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([route, count]) => ({ route, count })),
    latencyHeatmap: apm.heatmap.map((row) => [...row]),
    sdk: {
      turnP50Ms: percentile(apm.sdkTurnSamples, 0.5),
      turnP95Ms: percentile(apm.sdkTurnSamples, 0.95),
      turnP99Ms: percentile(apm.sdkTurnSamples, 0.99),
      turnsPerMinSeries: apm.sdkTurnPerMinSeries.toArray(),
    },
    slowOps: [...apm.slowOps],
  };
}

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}
