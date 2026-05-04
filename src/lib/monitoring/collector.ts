import { collectHealth, type HealthCollector, type HealthLongMetric } from "./collectors/health";
import { collectSystem, type SystemCollector } from "./collectors/system";
import { collectProcesses } from "./collectors/processes";
import { collectDocker, type DockerCollector } from "./collectors/docker";
import { collectCron } from "./collectors/cron";
import { collectWs } from "./collectors/ws";
import { collectApm, type ApmCollector } from "./collectors/apm";
import { collectLogs, type LogsCollector } from "./collectors/logs";
import { collectPreviews } from "./collectors/previews";
import { detectCapabilities } from "./env";
import type {
  ApmSnapshot,
  CronSnapshot,
  DockerSnapshot,
  HealthSnapshot,
  LogsSnapshot,
  MonCapabilities,
  PreviewsSnapshot,
  ProcessesSnapshot,
  SystemSnapshot,
  WsSnapshot,
} from "./types";

type SnapshotCacheKey =
  | "health"
  | "system"
  | "processes"
  | "docker"
  | "cron"
  | "ws"
  | "apm"
  | "logs"
  | "previews";

interface CachedSnapshot<T> {
  value: T;
  at: number;
}

type Listener = (key: SnapshotCacheKey, snapshot: unknown) => void;

interface TickConfig {
  key: SnapshotCacheKey;
  intervalMs: number;
  /** Fire the first tick on registration. */
  immediate?: boolean;
  fn: () => Promise<unknown>;
}

/**
 * Singleton orchestrator for the monitoring subsystem. Each collector ticks
 * on its own cadence, writes the result into an in-memory cache, and notifies
 * listeners (the WS broadcaster, primarily). HTTP endpoints read from the
 * cache — they never sample on the request path.
 *
 * Wraps every collector in try/catch so a failed collector doesn't bring down
 * the process. The cache returns the last good snapshot when a collector errors.
 */
export class MetricsCollector {
  private readonly cache = new Map<SnapshotCacheKey, CachedSnapshot<unknown>>();
  private readonly errors = new Map<SnapshotCacheKey, string>();
  private readonly timers = new Map<SnapshotCacheKey, NodeJS.Timeout>();
  private readonly listeners = new Set<Listener>();
  private readonly capabilities: MonCapabilities;
  private readonly health: HealthCollector;
  private readonly system: SystemCollector;
  private readonly docker: DockerCollector;
  private readonly apm: ApmCollector;
  private readonly logs: LogsCollector;
  private started = false;
  private readonly startedAt = Date.now();

  constructor(opts: {
    health: HealthCollector;
    system: SystemCollector;
    docker: DockerCollector;
    apm: ApmCollector;
    logs: LogsCollector;
  }) {
    this.capabilities = detectCapabilities();
    this.health = opts.health;
    this.system = opts.system;
    this.docker = opts.docker;
    this.apm = opts.apm;
    this.logs = opts.logs;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    const ticks: TickConfig[] = [
      {
        key: "health",
        intervalMs: 1000,
        immediate: true,
        fn: () => this.runCollector("health", () => collectHealth(this.health)),
      },
      {
        key: "system",
        intervalMs: 2000,
        immediate: true,
        fn: () => this.runCollector("system", () => collectSystem(this.system)),
      },
      {
        key: "processes",
        intervalMs: 5000,
        fn: () => this.runCollector("processes", () => collectProcesses()),
      },
      {
        key: "docker",
        intervalMs: 2000,
        fn: () => this.runCollector("docker", () => collectDocker(this.docker)),
      },
      {
        key: "cron",
        intervalMs: 5000,
        fn: () => this.runCollector("cron", () => collectCron()),
      },
      {
        key: "ws",
        intervalMs: 1000,
        immediate: true,
        fn: () => this.runCollector("ws", () => collectWs()),
      },
      {
        key: "apm",
        intervalMs: 1000,
        immediate: true,
        fn: () => this.runCollector("apm", () => collectApm(this.apm)),
      },
      {
        key: "logs",
        intervalMs: 2000,
        immediate: true,
        fn: () => this.runCollector("logs", () => collectLogs(this.logs)),
      },
      {
        key: "previews",
        intervalMs: 5000,
        fn: () => this.runCollector("previews", () => collectPreviews()),
      },
    ];

    for (const t of ticks) {
      if (t.immediate) {
        // Don't await — first tick is fire-and-forget. Subsequent ticks
        // happen on the interval below.
        void t.fn();
      }
      const timer = setInterval(t.fn, t.intervalMs);
      // Don't keep the event loop alive solely for monitoring.
      timer.unref?.();
      this.timers.set(t.key, timer);
    }
  }

  stop(): void {
    for (const t of this.timers.values()) clearInterval(t);
    this.timers.clear();
    this.started = false;
    this.health.dispose?.();
    this.docker.dispose?.();
    this.logs.dispose?.();
  }

  isStarted(): boolean {
    return this.started;
  }

  getCapabilities(): MonCapabilities {
    return this.capabilities;
  }

  getStartedAt(): number {
    return this.startedAt;
  }

  /** Register a listener that's notified on every successful tick. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Read-back accessors with proper return types. */
  getHealth(): HealthSnapshot | null {
    return this.read<HealthSnapshot>("health");
  }
  getSystem(): SystemSnapshot | null {
    return this.read<SystemSnapshot>("system");
  }
  getProcesses(): ProcessesSnapshot | null {
    return this.read<ProcessesSnapshot>("processes");
  }
  getDocker(): DockerSnapshot | null {
    return this.read<DockerSnapshot>("docker");
  }
  getCron(): CronSnapshot | null {
    return this.read<CronSnapshot>("cron");
  }
  getWs(): WsSnapshot | null {
    return this.read<WsSnapshot>("ws");
  }
  getApm(): ApmSnapshot | null {
    return this.read<ApmSnapshot>("apm");
  }
  getLogs(): LogsSnapshot | null {
    return this.read<LogsSnapshot>("logs");
  }
  getPreviews(): PreviewsSnapshot | null {
    return this.read<PreviewsSnapshot>("previews");
  }

  /**
   * Long-term health series accessor. Returns up to 1h of `(t, v)` pairs
   * for the named metric, optionally clipped to `[fromMs, toMs]`.
   */
  getHealthSeries(
    metric: HealthLongMetric,
    fromMs?: number,
    toMs?: number,
  ): Array<{ t: number; v: number }> {
    const buf = this.health.longSeries[metric];
    if (!buf) return [];
    return buf.toRange(fromMs, toMs);
  }

  /** Last-known-error message for diagnostics. */
  getLastError(key: SnapshotCacheKey): string | null {
    return this.errors.get(key) ?? null;
  }

  /** Force a re-collection regardless of timer schedule. */
  async refresh(key: SnapshotCacheKey): Promise<void> {
    switch (key) {
      case "health":
        await this.runCollector("health", () => collectHealth(this.health));
        break;
      case "system":
        await this.runCollector("system", () => collectSystem(this.system));
        break;
      case "processes":
        await this.runCollector("processes", () => collectProcesses());
        break;
      case "docker":
        await this.runCollector("docker", () => collectDocker(this.docker));
        break;
      case "cron":
        await this.runCollector("cron", () => collectCron());
        break;
      case "ws":
        await this.runCollector("ws", () => collectWs());
        break;
      case "apm":
        await this.runCollector("apm", () => collectApm(this.apm));
        break;
      case "logs":
        await this.runCollector("logs", () => collectLogs(this.logs));
        break;
      case "previews":
        await this.runCollector("previews", () => collectPreviews());
        break;
    }
  }

  /** Direct access to APM tracker — used by withApm middleware. */
  getApmTracker(): ApmCollector {
    return this.apm;
  }

  /** Direct access to logs sink — used by stdout/stderr capture. */
  getLogsSink(): LogsCollector {
    return this.logs;
  }

  private async runCollector(key: SnapshotCacheKey, fn: () => Promise<unknown>): Promise<void> {
    try {
      const value = await fn();
      this.cache.set(key, { value, at: Date.now() });
      this.errors.delete(key);
      for (const listener of this.listeners) {
        try {
          listener(key, value);
        } catch {
          /* listener errors are isolated */
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.errors.set(key, msg);
      // Keep last good cache; only log first occurrence per key.
      if (!this.errorAlreadyLogged.has(key)) {
        this.errorAlreadyLogged.add(key);
        console.warn(`[monitoring] ${key} collector failed:`, msg);
      }
    }
  }

  private errorAlreadyLogged = new Set<SnapshotCacheKey>();

  private read<T>(key: SnapshotCacheKey): T | null {
    const entry = this.cache.get(key);
    return entry ? (entry.value as T) : null;
  }
}
