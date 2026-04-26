import { extractSession, unauthorized } from "@/lib/auth-server";
import { getMetricsCollector } from "@/lib/monitoring/singleton";

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  const collector = getMetricsCollector();
  if (!collector) {
    return Response.json({ error: "Monitoring not initialized" }, { status: 503 });
  }
  const snapshot = collector.getApm();
  if (!snapshot) return Response.json({ available: false, reason: "collecting…" });
  return Response.json(snapshot);
}
