import { extractSession, unauthorized } from "@/lib/auth-server";
import { getMetricsCollector } from "@/lib/monitoring/singleton";
import { getAlertEngine } from "@/lib/monitoring/alerts/engine";

/**
 * Single mega JSON for the "Export snapshot" download. Operators can
 * attach this to a support ticket — it captures every visible section's
 * current state at one moment.
 */
export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  const collector = getMetricsCollector();
  if (!collector) {
    return Response.json({ error: "Monitoring not initialized" }, { status: 503 });
  }
  const exportedAt = new Date().toISOString();
  const body = {
    exportedAt,
    capabilities: collector.getCapabilities(),
    sections: {
      health: collector.getHealth(),
      system: collector.getSystem(),
      processes: collector.getProcesses(),
      docker: collector.getDocker(),
      ws: collector.getWs(),
      apm: collector.getApm(),
      logs: collector.getLogs(),
      cron: collector.getCron(),
      alerts: {
        firing: getAlertEngine().currentlyFiring(),
        history: getAlertEngine().recentHistory(50),
      },
    },
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="monitoring-${exportedAt}.json"`,
    },
  });
}
