/**
 * Type contracts for the Monitoring subsystem. Single source of truth shared
 * between collectors (server), API routes, and React components.
 *
 * Snapshots are returned by GET endpoints; ring-buffer series are streamed
 * over /ws/monitoring (see ws-broadcast.ts).
 */

export type MonStatus = "healthy" | "warning" | "critical" | "unknown" | "info";

export type MonSubsystemKey =
  | "health"
  | "system"
  | "processes"
  | "docker"
  | "ws"
  | "audit"
  | "cron"
  | "apm"
  | "logs"
  | "alerts";

export interface MonCapabilities {
  /** /var/run/docker.sock is reachable. */
  docker: boolean;
  /** /proc is readable (Linux). */
  proc: boolean;
  /** Node was started with --expose-gc. */
  exposeGc: boolean;
  /** /sys readable for thermals / block stats. */
  sys: boolean;
  /** Host /proc / /sys mounted in (HOST_PROC=/host/proc). */
  hostProcMount: string | null;
}

/* --------------------------------- Server health --------------------------------- */

export interface HealthSnapshot {
  process: {
    pid: number;
    uptimeMs: number;
    nodeVersion: string;
    /** Process start ISO. */
    startedAt: string;
  };
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  };
  eventLoop: {
    lagP50Ms: number;
    lagP95Ms: number;
    lagP99Ms: number;
    lagMaxMs: number;
  };
  gc: {
    pausesPerMin: number;
    totalPauseMsPerMin: number;
    lastFullGcAt: number | null;
  };
  series: {
    rssBytes: number[];
    heapUsedBytes: number[];
    eventLoopLagP95Ms: number[];
    gcPausesPerMin: number[];
  };
}

/* --------------------------------- System / device --------------------------------- */

export interface SystemDiskRow {
  mount: string;
  fsType: string;
  totalBytes: number;
  usedBytes: number;
  availBytes: number;
  /** Bytes/second over the last sample window. */
  readBytesPerSec: number;
  writeBytesPerSec: number;
  readSeries: number[];
  writeSeries: number[];
}

export interface SystemNetIfaceRow {
  iface: string;
  rxBytesPerSec: number;
  txBytesPerSec: number;
  rxSeries: number[];
  txSeries: number[];
  rxErrors: number;
  txErrors: number;
  rxDropped: number;
  txDropped: number;
}

export interface SystemSnapshot {
  host: {
    hostname: string;
    platform: string;
    distro: string | null;
    release: string | null;
    kernel: string;
    arch: string;
    cores: number;
    physicalCores: number;
    totalRamBytes: number;
  };
  cpu: {
    aggregatePct: number;
    perCorePct: number[];
    load1: number;
    load5: number;
    load15: number;
    speedMHz: number | null;
    tempCelsius: number | null;
    series: number[];
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    cachedBytes: number;
    buffersBytes: number;
    series: number[];
  };
  swap: {
    totalBytes: number;
    usedBytes: number;
  };
  disks: SystemDiskRow[];
  interfaces: SystemNetIfaceRow[];
  fileDescriptors: {
    open: number;
    /** -1 if unknown / unlimited. */
    limit: number;
  };
}

/* --------------------------------- Processes --------------------------------- */

export interface ProcessRow {
  pid: number;
  ppid: number;
  user: string;
  name: string;
  /** Scrubbed cmdline (secrets removed). */
  cmdline: string;
  cpuPct: number;
  memBytes: number;
  threads: number;
  state: string;
  startTimeMs: number | null;
}

export interface ProcessesSnapshot {
  rows: ProcessRow[];
  totalProcs: number;
  zombieCount: number;
  available: boolean;
  reason?: string;
}

/* --------------------------------- Docker --------------------------------- */

export interface DockerContainerRow {
  id: string;
  name: string;
  image: string;
  status:
    | "running"
    | "paused"
    | "exited"
    | "created"
    | "restarting"
    | "dead"
    | "removing"
    | "unknown";
  health?: "healthy" | "unhealthy" | "starting" | "none";
  cpuPct: number;
  memBytes: number;
  memLimitBytes: number;
  netRxBytesPerSec: number;
  netTxBytesPerSec: number;
  cpuSeries: number[];
  memSeries: number[];
  startedAt: number | null;
  ports: Array<{ host?: number; container: number; proto: "tcp" | "udp" }>;
  restartCount: number;
}

export interface DockerSnapshot {
  available: boolean;
  reason?: string;
  daemon: { connected: boolean; version?: string };
  containers: DockerContainerRow[];
  aggregates: {
    images: { count: number; sizeBytes: number };
    volumes: { count: number };
    networks: { count: number };
    running: number;
    stopped: number;
  };
}

/* --------------------------------- WebSockets --------------------------------- */

export interface WsSessionRow {
  id: string;
  state: "idle" | "busy" | "awaiting_permission" | "closing" | "unknown";
  clientCount: number;
  queueDepth: number;
  pendingRequests: number;
  connectedAt: number | null;
  lastActivityAt: number;
  msgsIn: number;
  msgsOut: number;
  bytesIn: number;
  bytesOut: number;
  msgsInSeries: number[];
  msgsOutSeries: number[];
  /** Human-readable client (truncated UA). */
  client?: string;
  ip?: string;
}

export interface WsSnapshot {
  active: number;
  totalEverConnected: number;
  msgsInPerSec: number;
  msgsOutPerSec: number;
  bytesInPerSec: number;
  bytesOutPerSec: number;
  series: {
    active: number[];
    msgsInPerSec: number[];
    msgsOutPerSec: number[];
  };
  sessions: WsSessionRow[];
}

/* --------------------------------- Cron --------------------------------- */

export interface CronAggregates {
  jobsTotal: number;
  jobsActive: number;
  jobsRunning: number;
  runsLast24h: number;
  successRate: number;
  avgDurationMs: number;
  /** 24 buckets, hour-aligned, oldest first. */
  runsByHour: number[];
}

export interface CronSnapshot {
  aggregates: CronAggregates;
}

/* --------------------------------- APM --------------------------------- */

export interface ApmRouteRow {
  route: string;
  method: string;
  calls: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorRate: number;
}

export interface ApmSlowOpRow {
  id: string;
  at: number;
  route: string;
  method: string;
  durationMs: number;
  statusCode: number;
  actor: string;
}

export interface ApmSnapshot {
  summary: {
    rpm: number;
    errorRate: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
  };
  series: {
    rpm: number[];
    p50Ms: number[];
    p95Ms: number[];
    p99Ms: number[];
  };
  routes: ApmRouteRow[];
  errorsByRoute: Array<{ route: string; count: number }>;
  /** rows × cols of buckets, indexed by latency band (rows) and time bucket (cols). */
  latencyHeatmap: number[][];
  sdk: {
    turnP50Ms: number;
    turnP95Ms: number;
    turnP99Ms: number;
    turnsPerMinSeries: number[];
  };
  slowOps: ApmSlowOpRow[];
}

/* --------------------------------- Logs --------------------------------- */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogLine {
  t: number;
  level: LogLevel;
  source: "stdout" | "stderr";
  message: string;
}

export interface LogErrorGroup {
  fingerprint: string;
  sample: LogLine;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

export interface LogsSnapshot {
  counts: {
    errorsLast5m: number;
    errorsLast1h: number;
    errorsLast24h: number;
    tailRatePerSec: number;
  };
  errorGroups: LogErrorGroup[];
  /** Most recent N lines (server keeps a ring buffer, default 5000). */
  recent: LogLine[];
}

/* --------------------------------- Alerts --------------------------------- */

export type AlertOperator = ">" | "<" | ">=" | "<=" | "==";

export type AlertSeverity = "warning" | "critical";

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  /**
   * Dotted metric path, e.g. "health.eventLoop.lagP95Ms".
   * Special form: `audit.count(category=...,severity=...,window=Ns)` to
   * fire on audit-event patterns rather than gauge metrics.
   */
  metric: string;
  operator: AlertOperator;
  threshold: number;
  /** Sustained duration before firing. */
  forMs: number;
  severity: AlertSeverity;
  /**
   * Channels are pluggable. v1 honours `webPush` and `webhook`. Email
   * + SMS land in a follow-up PR.
   */
  notify: {
    webPush?: boolean;
    webhook?: { url: string };
  };
  /** Optional URL to a runbook explaining what to do when this fires. */
  runbookUrl?: string;
  snoozedUntil?: number;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  state: "firing" | "resolved";
  severity: AlertSeverity;
  firedAt: number;
  resolvedAt?: number;
  observedValue: number;
  threshold: number;
  ackedAt?: number;
  ackedBy?: string;
  /** Copied from the rule when fired so the UI can link without a re-fetch. */
  runbookUrl?: string;
}

export interface MaintenanceWindow {
  id: string;
  name: string;
  /** Start / end ms-epoch. For recurring windows these are the next occurrence. */
  startsAt: number;
  endsAt: number;
  /** Optional cron expression; when set, `startsAt`/`endsAt` are recomputed. */
  recurringCron?: string;
  /** Duration in ms for recurring windows. */
  recurringDurationMs?: number;
  /** If non-empty, only suppress these specific rule ids. Otherwise suppresses all. */
  ruleIds?: string[];
  reason?: string;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
}

export interface AlertsSnapshot {
  rules: AlertRule[];
  firing: AlertEvent[];
}

/* --------------------------------- Overview --------------------------------- */

export interface OverviewKeyMetric {
  id: string;
  label: string;
  value: number;
  formattedValue: string;
  unit: string;
  status: MonStatus;
  sparkline: number[];
}

export interface OverviewSubsystem {
  key: MonSubsystemKey;
  status: MonStatus;
  summary: string;
  /** Optional badge value (e.g., container count). */
  badge?: string;
}

export interface OverviewSnapshot {
  overall: MonStatus;
  uptimeMs: number;
  capabilities: MonCapabilities;
  subsystems: OverviewSubsystem[];
  keyMetrics: OverviewKeyMetric[];
  firingAlerts: Array<{
    id: string;
    severity: AlertSeverity;
    ruleName: string;
    firingForMs: number;
    observedValue: number;
    threshold: number;
  }>;
}

/* --------------------------------- WS protocol --------------------------------- */

export type MonFrame =
  | { type: "subscribe"; topics: string[] }
  | { type: "unsubscribe"; topics: string[] }
  | { type: "ping"; t: number }
  | { type: "pong"; t: number }
  | { type: "metric"; topic: string; t: number; v: number | number[] }
  | {
      type: "snapshot";
      topic: string;
      series: Array<{ t: number; v: number | number[] }>;
    }
  | { type: "event"; topic: string; payload: unknown }
  | { type: "error"; reason: string }
  | { type: "ready"; serverTime: number; capabilities: MonCapabilities };
