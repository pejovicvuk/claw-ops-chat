import { extractSession, unauthorized } from "@/lib/auth-server";
import { getMetricsCollector } from "@/lib/monitoring/singleton";

const VALID_METRICS = new Set([
  "rssBytes",
  "heapUsedBytes",
  "heapTotalBytes",
  "externalBytes",
  "loopP50Ms",
  "loopP95Ms",
  "loopP99Ms",
  "gcPausesPerMin",
  "gcTimePerMin",
] as const);

type ValidMetric = typeof VALID_METRICS extends Set<infer T> ? T : never;

const MAX_RANGE_MS = 60 * 60 * 1000; // 1h

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  const collector = getMetricsCollector();
  if (!collector) {
    return Response.json({ error: "Monitoring not initialized" }, { status: 503 });
  }
  const url = new URL(request.url);
  const metricsParam = url.searchParams.get("metrics") ?? "";
  const metrics = metricsParam
    .split(",")
    .map((m) => m.trim())
    .filter((m): m is ValidMetric => VALID_METRICS.has(m as ValidMetric));
  if (metrics.length === 0) {
    return Response.json(
      {
        error: `metrics required, comma-separated. Valid: ${[...VALID_METRICS].join(", ")}`,
      },
      { status: 400 },
    );
  }
  const now = Date.now();
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const to = toParam ? Math.min(Number.parseInt(toParam, 10) || now, now) : now;
  const fromMin = to - MAX_RANGE_MS;
  const from = fromParam ? Math.max(Number.parseInt(fromParam, 10) || fromMin, fromMin) : fromMin;
  const result: Record<string, Array<{ t: number; v: number }>> = {};
  for (const m of metrics) {
    result[m] = collector.getHealthSeries(m, from, to);
  }
  return Response.json({ from, to, series: result });
}
