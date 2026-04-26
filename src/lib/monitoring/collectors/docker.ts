import { detectCapabilities, getDockerSocketPath } from "../env";
import { RingBuffer } from "../ring-buffer";
import type { DockerContainerRow, DockerSnapshot } from "../types";

const SERIES_LEN = 60;

interface ContainerSeries {
  cpu: RingBuffer;
  mem: RingBuffer;
}

export interface DockerCollector {
  /** dockerode instance — loaded lazily on first use. Null if socket missing. */
  client: unknown | null;
  containerSeries: Map<string, ContainerSeries>;
  /** Last-seen container ids; used to evict series for removed containers. */
  lastContainerIds: Set<string>;
  available: boolean;
  reason?: string;
  dispose?: () => void;
}

export function createDockerCollector(): DockerCollector {
  const caps = detectCapabilities();
  const collector: DockerCollector = {
    client: null,
    containerSeries: new Map(),
    lastContainerIds: new Set(),
    available: caps.docker,
    reason: caps.docker ? undefined : "Docker socket not mounted",
  };
  collector.dispose = () => {
    collector.containerSeries.clear();
    collector.lastContainerIds.clear();
  };
  return collector;
}

interface ContainerInspect {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Created: number;
  Ports?: Array<{ PrivatePort?: number; PublicPort?: number; Type?: string }>;
}

interface ContainerStats {
  cpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
  };
  memory_stats: {
    usage?: number;
    limit?: number;
    stats?: Record<string, number>;
  };
  networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
}

interface DockerodeContainer {
  inspect(): Promise<{
    Id: string;
    Name: string;
    Config: { Image: string };
    State: { Status: string; Health?: { Status: string }; StartedAt: string };
    RestartCount: number;
    NetworkSettings: { Ports?: Record<string, Array<{ HostPort?: string }>> };
  }>;
  stats(opts: { stream: false }): Promise<ContainerStats>;
}

interface DockerodeApi {
  listContainers(opts: { all: boolean }): Promise<ContainerInspect[]>;
  getContainer(id: string): DockerodeContainer;
  listImages(): Promise<Array<{ Id: string; Size: number }>>;
  listVolumes(): Promise<{ Volumes?: unknown[] | null }>;
  listNetworks(): Promise<unknown[]>;
  version(): Promise<{ Version: string }>;
}

async function getDockerClient(c: DockerCollector): Promise<DockerodeApi | null> {
  if (!c.available) return null;
  if (c.client) return c.client as DockerodeApi;
  try {
    // Dynamic import keeps dockerode out of the bundle when the socket
    // isn't mounted (no Docker visibility).
    const mod = await import("dockerode");
    const Docker = mod.default;
    const socketPath = getDockerSocketPath();
    if (!socketPath) {
      c.available = false;
      c.reason = "Docker socket not mounted";
      return null;
    }
    const client = new Docker({ socketPath });
    c.client = client;
    return client as unknown as DockerodeApi;
  } catch (err) {
    c.available = false;
    c.reason = err instanceof Error ? err.message : "dockerode failed to load";
    return null;
  }
}

export async function collectDocker(c: DockerCollector): Promise<DockerSnapshot> {
  const client = await getDockerClient(c);
  if (!client) {
    return {
      available: false,
      reason: c.reason ?? "Docker not configured",
      daemon: { connected: false },
      containers: [],
      aggregates: {
        images: { count: 0, sizeBytes: 0 },
        volumes: { count: 0 },
        networks: { count: 0 },
        running: 0,
        stopped: 0,
      },
    };
  }

  let version = "";
  try {
    const v = await client.version();
    version = v.Version;
  } catch {
    /* daemon may be down */
  }

  let listed: ContainerInspect[] = [];
  try {
    listed = await client.listContainers({ all: true });
  } catch (err) {
    return {
      available: true,
      reason: err instanceof Error ? err.message : "list containers failed",
      daemon: { connected: false, version },
      containers: [],
      aggregates: {
        images: { count: 0, sizeBytes: 0 },
        volumes: { count: 0 },
        networks: { count: 0 },
        running: 0,
        stopped: 0,
      },
    };
  }

  const seenIds = new Set<string>();
  const rows: DockerContainerRow[] = [];
  let running = 0;
  let stopped = 0;

  // Stats are expensive — fan out in parallel but cap concurrency.
  const statTasks = listed.map(async (info) => {
    seenIds.add(info.Id);
    const status = mapStatus(info.State);
    if (status === "running") running += 1;
    else stopped += 1;

    let series = c.containerSeries.get(info.Id);
    if (!series) {
      series = { cpu: new RingBuffer(SERIES_LEN), mem: new RingBuffer(SERIES_LEN) };
      c.containerSeries.set(info.Id, series);
    }

    let cpuPct = 0;
    let memBytes = 0;
    let memLimit = 0;
    let netRx = 0;
    let netTx = 0;
    let restartCount = 0;
    let startedAt: number | null = null;
    let healthStatus: DockerContainerRow["health"] = "none";

    if (status === "running") {
      try {
        const ct = client.getContainer(info.Id);
        const [stats, inspected] = await Promise.all([ct.stats({ stream: false }), ct.inspect()]);
        cpuPct = computeCpuPercent(stats);
        memBytes = stats.memory_stats.usage ?? 0;
        memLimit = stats.memory_stats.limit ?? 0;
        if (stats.networks) {
          for (const v of Object.values(stats.networks)) {
            netRx += v.rx_bytes;
            netTx += v.tx_bytes;
          }
        }
        restartCount = inspected.RestartCount ?? 0;
        startedAt = inspected.State?.StartedAt
          ? Date.parse(inspected.State.StartedAt) || null
          : null;
        const h = inspected.State?.Health?.Status;
        if (h === "healthy" || h === "unhealthy" || h === "starting") healthStatus = h;
      } catch {
        /* container disappeared mid-iteration; row still rendered */
      }
    }

    series.cpu.push(cpuPct);
    series.mem.push(memBytes);

    rows.push({
      id: info.Id,
      name: info.Names[0]?.replace(/^\//, "") ?? info.Id.slice(0, 12),
      image: info.Image,
      status,
      health: healthStatus,
      cpuPct: Math.round(cpuPct * 10) / 10,
      memBytes,
      memLimitBytes: memLimit,
      // Total RX/TX bytes since container start (not per-sec). Use as a
      // monotonic counter the UI can diff if it cares; avoids needing a
      // second sample window here.
      netRxBytesPerSec: netRx,
      netTxBytesPerSec: netTx,
      cpuSeries: series.cpu.toArray(),
      memSeries: series.mem.toArray(),
      startedAt,
      ports: (info.Ports ?? [])
        .filter((p) => typeof p.PrivatePort === "number")
        .map((p) => ({
          host: typeof p.PublicPort === "number" ? p.PublicPort : undefined,
          container: p.PrivatePort as number,
          proto: (p.Type === "udp" ? "udp" : "tcp") as "tcp" | "udp",
        })),
      restartCount,
    });
  });

  await Promise.all(statTasks);

  // Evict series for removed containers.
  for (const id of c.lastContainerIds) {
    if (!seenIds.has(id)) c.containerSeries.delete(id);
  }
  c.lastContainerIds = seenIds;

  let imagesAgg = { count: 0, sizeBytes: 0 };
  try {
    const images = await client.listImages();
    imagesAgg = { count: images.length, sizeBytes: images.reduce((a, b) => a + (b.Size ?? 0), 0) };
  } catch {
    /* best effort */
  }
  let volumesCount = 0;
  try {
    const v = await client.listVolumes();
    volumesCount = (v.Volumes ?? []).length;
  } catch {
    /* best effort */
  }
  let networksCount = 0;
  try {
    const n = await client.listNetworks();
    networksCount = n.length;
  } catch {
    /* best effort */
  }

  rows.sort((a, b) => b.cpuPct - a.cpuPct);

  return {
    available: true,
    daemon: { connected: true, version },
    containers: rows,
    aggregates: {
      images: imagesAgg,
      volumes: { count: volumesCount },
      networks: { count: networksCount },
      running,
      stopped,
    },
  };
}

function mapStatus(state: string): DockerContainerRow["status"] {
  switch (state) {
    case "running":
    case "paused":
    case "exited":
    case "created":
    case "restarting":
    case "dead":
    case "removing":
      return state;
    default:
      return "unknown";
  }
}

/** CPU% calculation from Docker stats — same formula docker CLI uses. */
function computeCpuPercent(stats: ContainerStats): number {
  const cpuDelta =
    (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) -
    (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const sysDelta =
    (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);
  const onlineCpus = stats.cpu_stats?.online_cpus ?? 1;
  if (cpuDelta <= 0 || sysDelta <= 0) return 0;
  return (cpuDelta / sysDelta) * onlineCpus * 100;
}

export async function getDockerodeClient(c: DockerCollector): Promise<DockerodeApi | null> {
  return getDockerClient(c);
}
