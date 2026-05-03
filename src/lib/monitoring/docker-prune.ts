/**
 * Docker prune subsystem — reclaims disk space taken by unused images,
 * stopped containers, dangling networks, and the build cache.
 *
 * Two entry points:
 *   - `runDockerPrune()` — executes the prune via the dockerode client
 *     already cached on the metrics collector. Returns total bytes freed.
 *   - `maybeRunScheduledPrune()` — called every hour by the cron in
 *     `server.ts`. Reads config; runs prune iff enabled AND the configured
 *     interval has elapsed since `lastRunAt`.
 *
 * Volumes are intentionally NOT pruned (they hold user data). The audit
 * trail is written via the standard `api` category.
 */

import { existsSync } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname } from "path";

import { getAuditWriter } from "../audit/writer";
import { getDockerodeClient } from "./collectors/docker";
import { getMetricsCollector } from "./singleton";

const STORE_PATH = "/root/.monitoring/docker-prune.json";
const DEFAULT_INTERVAL_DAYS = 7;
const MIN_INTERVAL_DAYS = 1;
const MAX_INTERVAL_DAYS = 365;

export interface DockerPruneConfig {
  enabled: boolean;
  intervalDays: number;
  lastRunAt: number | null;
  lastBytesFreed: number;
  lastError: string | null;
}

interface StoreFile {
  v: 1;
  config: DockerPruneConfig;
}

interface PruneApiResponse {
  SpaceReclaimed?: number;
}

interface DockerodePruneApi {
  pruneContainers(opts?: Record<string, unknown>): Promise<PruneApiResponse>;
  pruneImages(opts?: Record<string, unknown>): Promise<PruneApiResponse>;
  pruneNetworks(opts?: Record<string, unknown>): Promise<PruneApiResponse>;
  pruneBuilder(opts?: Record<string, unknown>): Promise<PruneApiResponse>;
}

const DEFAULT_CONFIG: DockerPruneConfig = {
  enabled: true,
  intervalDays: DEFAULT_INTERVAL_DAYS,
  lastRunAt: null,
  lastBytesFreed: 0,
  lastError: null,
};

function clampIntervalDays(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_INTERVAL_DAYS;
  return Math.min(MAX_INTERVAL_DAYS, Math.max(MIN_INTERVAL_DAYS, Math.floor(n)));
}

async function ensureStoreDir(): Promise<void> {
  const dir = dirname(STORE_PATH);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function readStore(): Promise<StoreFile> {
  if (!existsSync(STORE_PATH)) return { v: 1, config: { ...DEFAULT_CONFIG } };
  try {
    const raw = await readFile(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as StoreFile;
    if (parsed.v !== 1 || typeof parsed.config !== "object" || parsed.config === null) {
      return { v: 1, config: { ...DEFAULT_CONFIG } };
    }
    return {
      v: 1,
      config: {
        enabled: typeof parsed.config.enabled === "boolean" ? parsed.config.enabled : true,
        intervalDays: clampIntervalDays(parsed.config.intervalDays),
        lastRunAt: typeof parsed.config.lastRunAt === "number" ? parsed.config.lastRunAt : null,
        lastBytesFreed:
          typeof parsed.config.lastBytesFreed === "number" ? parsed.config.lastBytesFreed : 0,
        lastError: typeof parsed.config.lastError === "string" ? parsed.config.lastError : null,
      },
    };
  } catch {
    return { v: 1, config: { ...DEFAULT_CONFIG } };
  }
}

async function writeStore(file: StoreFile): Promise<void> {
  await ensureStoreDir();
  const tmp = `${STORE_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), "utf-8");
  await rename(tmp, STORE_PATH);
}

export async function getDockerPruneConfig(): Promise<DockerPruneConfig> {
  return (await readStore()).config;
}

export async function updateDockerPruneConfig(
  patch: Partial<Pick<DockerPruneConfig, "enabled" | "intervalDays">>,
): Promise<DockerPruneConfig> {
  const store = await readStore();
  const next: DockerPruneConfig = {
    ...store.config,
    ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
    ...(typeof patch.intervalDays === "number"
      ? { intervalDays: clampIntervalDays(patch.intervalDays) }
      : {}),
  };
  await writeStore({ v: 1, config: next });
  return next;
}

export interface DockerPruneResult {
  bytesFreed: number;
  containers: number;
  images: number;
  networks: number;
  builder: number;
  errors: string[];
}

/**
 * Execute the prune. Calls all four pruneXxx methods on dockerode and
 * sums the SpaceReclaimed counters. Per-step failures are collected into
 * `errors` rather than aborting the whole run, so one bad step doesn't
 * block the others. Persists the run summary into the config store so
 * the UI can show "last run" without keeping a separate history file.
 */
export async function runDockerPrune(actor: string): Promise<DockerPruneResult> {
  const collector = getMetricsCollector();
  const dockerState = collector
    ? (collector as unknown as { docker: Parameters<typeof getDockerodeClient>[0] }).docker
    : null;
  if (!collector || !dockerState) {
    throw new Error("Docker not configured");
  }
  const cli = (await getDockerodeClient(dockerState)) as unknown as DockerodePruneApi | null;
  if (!cli) {
    throw new Error("Docker unavailable");
  }

  const result: DockerPruneResult = {
    bytesFreed: 0,
    containers: 0,
    images: 0,
    networks: 0,
    builder: 0,
    errors: [],
  };

  async function step(
    label: "containers" | "images" | "networks" | "builder",
    fn: () => Promise<PruneApiResponse>,
  ): Promise<void> {
    try {
      const res = await fn();
      const reclaimed = typeof res?.SpaceReclaimed === "number" ? res.SpaceReclaimed : 0;
      result.bytesFreed += reclaimed;
      result[label] = reclaimed;
    } catch (err) {
      result.errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // `pruneImages({all: true})` is the dockerode equivalent of `docker
  // image prune -a` — also drops images not referenced by any container,
  // not just dangling ones. This is the big space-saver.
  await step("containers", () => cli.pruneContainers({}));
  await step("images", () => cli.pruneImages({ filters: { dangling: { false: true } } }));
  await step("networks", () => cli.pruneNetworks({}));
  await step("builder", () => cli.pruneBuilder({}));

  // Persist run summary into the config store (single source of truth
  // for the UI's "last run" widget — no separate history file needed).
  const store = await readStore();
  const next: DockerPruneConfig = {
    ...store.config,
    lastRunAt: Date.now(),
    lastBytesFreed: result.bytesFreed,
    lastError: result.errors.length > 0 ? result.errors.join("; ").slice(0, 500) : null,
  };
  await writeStore({ v: 1, config: next });

  await getAuditWriter()
    .api({
      type: result.errors.length > 0 ? "request_error" : "request_complete",
      severity: result.errors.length > 0 ? "warn" : "info",
      actor,
      subject: `monitoring.docker_prune: ${formatBytesShort(result.bytesFreed)} freed`,
      durationMs: null,
      route: "/api/monitoring/docker/prune/run",
      method: "POST",
      statusCode: result.errors.length > 0 ? 207 : 200,
      details: {
        bytesFreed: result.bytesFreed,
        containers: result.containers,
        images: result.images,
        networks: result.networks,
        builder: result.builder,
        errors: result.errors,
      },
    })
    .catch(() => {});

  return result;
}

/**
 * Hourly tick called by `server.ts` cron. Cheap when the interval hasn't
 * elapsed — just reads the JSON file and returns. Runs the prune
 * otherwise, swallowing errors into the persisted `lastError` field so a
 * dead Docker socket doesn't crash the cron loop.
 */
export async function maybeRunScheduledPrune(): Promise<DockerPruneResult | null> {
  const config = await getDockerPruneConfig();
  if (!config.enabled) return null;
  const intervalMs = config.intervalDays * 24 * 60 * 60 * 1000;
  if (config.lastRunAt !== null && Date.now() - config.lastRunAt < intervalMs) {
    return null;
  }
  try {
    return await runDockerPrune("system:cron");
  } catch (err) {
    // Persist the error so the UI shows why the cron isn't doing
    // anything (e.g. Docker socket missing in dev).
    const store = await readStore();
    await writeStore({
      v: 1,
      config: {
        ...store.config,
        lastError: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
      },
    });
    return null;
  }
}

function formatBytesShort(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const __test__ = {
  STORE_PATH,
  DEFAULT_CONFIG,
  clampIntervalDays,
  formatBytesShort,
};
