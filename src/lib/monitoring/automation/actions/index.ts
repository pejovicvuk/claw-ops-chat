import type { AutomationActionFn, RuleKind } from "../types";
import { pruneDockerLogs } from "./prune-docker-logs";
import { pruneDockerImages } from "./prune-docker-images";
import { trimAuditRetention } from "./trim-audit-retention";
import { trimCacheDirs } from "./trim-cache-dirs";
import { trimHeapSnapshots } from "./trim-heap-snapshots";
import { trimMonitoringHistory } from "./trim-monitoring-history";
import { forceGcOnThreshold } from "./force-gc-on-threshold";
import { dropFsCaches } from "./drop-fs-caches";
import { restartUnhealthyContainer } from "./restart-unhealthy-container";

/** Lookup table mapping rule kind → action implementation. */
export const ACTIONS: Record<RuleKind, AutomationActionFn> = {
  schedule_prune_docker_logs: pruneDockerLogs,
  schedule_prune_docker_images: pruneDockerImages,
  schedule_trim_audit: trimAuditRetention,
  schedule_trim_cache: trimCacheDirs,
  schedule_trim_heap_snapshots: trimHeapSnapshots,
  schedule_trim_monitoring_history: trimMonitoringHistory,
  trigger_force_gc: forceGcOnThreshold,
  trigger_drop_fs_caches: dropFsCaches,
  trigger_restart_unhealthy_container: restartUnhealthyContainer,
};
