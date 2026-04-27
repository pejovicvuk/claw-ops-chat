import { MetricsCollector } from "./collector";
import { createApmCollector } from "./collectors/apm";
import { createDockerCollector } from "./collectors/docker";
import { createHealthCollector } from "./collectors/health";
import { createLogsCollector, attachStdoutCapture } from "./collectors/logs";
import { createSystemCollector } from "./collectors/system";
import { setMetricsCollector } from "./singleton";
import { getMonitoringBroadcaster } from "./ws-broadcast";
import { getAlertEngine } from "./alerts/engine";
import { getAutomationEngine } from "./automation/engine";

/**
 * Initialize the monitoring subsystem at server startup. Must be called
 * exactly once from `server.ts` after the audit subsystem is ready.
 */
export function bootstrapMonitoring(): MetricsCollector {
  const logs = createLogsCollector();
  attachStdoutCapture(logs);

  const collector = new MetricsCollector({
    health: createHealthCollector(),
    system: createSystemCollector(),
    docker: createDockerCollector(),
    apm: createApmCollector(),
    logs,
  });
  collector.start();
  setMetricsCollector(collector);

  // Wire WebSocket broadcaster to the collector tick events.
  getMonitoringBroadcaster().attach(collector);

  // Start alert engine (reads rules + ticks evaluator + dispatches).
  getAlertEngine().start();

  // Start automation engine (cron + trigger-driven cleanup actions).
  void getAutomationEngine()
    .start()
    .catch((err: unknown) => {
      console.warn(
        `[automation] engine bootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

  console.log("> Monitoring subsystem initialized");
  return collector;
}
