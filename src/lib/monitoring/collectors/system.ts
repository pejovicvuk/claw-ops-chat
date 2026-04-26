import si from "systeminformation";
import { RingBuffer } from "../ring-buffer";
import type { SystemDiskRow, SystemNetIfaceRow, SystemSnapshot } from "../types";

const SERIES_LEN = 60;

interface DiskSeries {
  read: RingBuffer;
  write: RingBuffer;
}

interface NetSeries {
  rx: RingBuffer;
  tx: RingBuffer;
}

export interface SystemCollector {
  cpuSeries: RingBuffer;
  memSeries: RingBuffer;
  /** Cached, expensive — refreshed every 5 minutes. */
  hostInfoCachedAt: number;
  hostInfo: {
    hostname: string;
    platform: string;
    distro: string | null;
    release: string | null;
    kernel: string;
    arch: string;
    cores: number;
    physicalCores: number;
    totalRamBytes: number;
  } | null;
  /** Per-mount disk I/O ring buffers, keyed by mount. */
  diskSeries: Map<string, DiskSeries>;
  /** Per-iface net ring buffers, keyed by iface name. */
  netSeries: Map<string, NetSeries>;
}

const HOST_INFO_TTL_MS = 5 * 60 * 1000;

export function createSystemCollector(): SystemCollector {
  return {
    cpuSeries: new RingBuffer(SERIES_LEN),
    memSeries: new RingBuffer(SERIES_LEN),
    hostInfoCachedAt: 0,
    hostInfo: null,
    diskSeries: new Map(),
    netSeries: new Map(),
  };
}

export async function collectSystem(c: SystemCollector): Promise<SystemSnapshot> {
  const now = Date.now();
  if (!c.hostInfo || now - c.hostInfoCachedAt > HOST_INFO_TTL_MS) {
    const [cpu, osInfo, mem] = await Promise.all([si.cpu(), si.osInfo(), si.mem()]);
    c.hostInfo = {
      hostname: osInfo.hostname || "unknown",
      platform: osInfo.platform || "unknown",
      distro: osInfo.distro || null,
      release: osInfo.release || null,
      kernel: osInfo.kernel || "",
      arch: osInfo.arch || process.arch,
      cores: cpu.cores || 1,
      physicalCores: cpu.physicalCores || 1,
      totalRamBytes: mem.total,
    };
    c.hostInfoCachedAt = now;
  }

  const [load, mem, fsSize, netStats, fileFds, cpuTemp] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize().catch(() => []),
    si.networkStats().catch(() => []),
    si.processes().catch(() => null),
    si.cpuTemperature().catch(() => null),
  ]);

  const aggregatePct = Math.round(load.currentLoad * 10) / 10;
  c.cpuSeries.push(aggregatePct);
  const memUsedPct = mem.total > 0 ? (mem.active / mem.total) * 100 : 0;
  c.memSeries.push(Math.round(memUsedPct * 10) / 10);

  const perCore = (load.cpus || []).map((cpu) => Math.round(cpu.load * 10) / 10);

  const disks: SystemDiskRow[] = [];
  for (const fs of fsSize) {
    if (!fs.mount) continue;
    let series = c.diskSeries.get(fs.mount);
    if (!series) {
      series = { read: new RingBuffer(SERIES_LEN), write: new RingBuffer(SERIES_LEN) };
      c.diskSeries.set(fs.mount, series);
    }
    // si doesn't expose per-mount IO bytes/sec reliably without `fsStats()`.
    // Track 0 for now and let users see capacity; per-mount IO bps best-effort.
    series.read.push(0);
    series.write.push(0);
    disks.push({
      mount: fs.mount,
      fsType: fs.type ?? "",
      totalBytes: fs.size,
      usedBytes: fs.used,
      availBytes: fs.size - fs.used,
      readBytesPerSec: 0,
      writeBytesPerSec: 0,
      readSeries: series.read.toArray(),
      writeSeries: series.write.toArray(),
    });
  }

  const interfaces: SystemNetIfaceRow[] = [];
  for (const net of netStats) {
    if (!net.iface) continue;
    let series = c.netSeries.get(net.iface);
    if (!series) {
      series = { rx: new RingBuffer(SERIES_LEN), tx: new RingBuffer(SERIES_LEN) };
      c.netSeries.set(net.iface, series);
    }
    const rxBps = Math.max(0, net.rx_sec ?? 0);
    const txBps = Math.max(0, net.tx_sec ?? 0);
    series.rx.push(rxBps);
    series.tx.push(txBps);
    interfaces.push({
      iface: net.iface,
      rxBytesPerSec: rxBps,
      txBytesPerSec: txBps,
      rxSeries: series.rx.toArray(),
      txSeries: series.tx.toArray(),
      rxErrors: net.rx_errors ?? 0,
      txErrors: net.tx_errors ?? 0,
      rxDropped: net.rx_dropped ?? 0,
      txDropped: net.tx_dropped ?? 0,
    });
  }

  let openFds = 0;
  let limitFds = -1;
  try {
    const { readFile } = await import("fs/promises");
    const limitsRaw = await readFile("/proc/self/limits", "utf-8").catch(() => null);
    if (limitsRaw) {
      const m = /Max open files\s+(\d+)\s+(\d+)/.exec(limitsRaw);
      if (m) limitFds = Number.parseInt(m[1], 10);
    }
    const fdEntries = await import("fs/promises").then((fs) => fs.readdir("/proc/self/fd"));
    openFds = fdEntries.length;
  } catch {
    /* /proc unavailable */
  }

  const result: SystemSnapshot = {
    host: c.hostInfo,
    cpu: {
      aggregatePct,
      perCorePct: perCore,
      load1: load.avgLoad ?? 0,
      load5: 0,
      load15: 0,
      speedMHz: null,
      tempCelsius: cpuTemp?.main ?? null,
      series: c.cpuSeries.toArray(),
    },
    memory: {
      totalBytes: mem.total,
      usedBytes: mem.active,
      freeBytes: mem.available,
      cachedBytes: mem.cached ?? 0,
      buffersBytes: mem.buffers ?? 0,
      series: c.memSeries.toArray(),
    },
    swap: {
      totalBytes: mem.swaptotal,
      usedBytes: mem.swapused,
    },
    disks,
    interfaces,
    fileDescriptors: {
      open: openFds,
      limit: limitFds,
    },
  };
  // fileFds + cpuTemp are referenced for typing satisfaction; avoid lint warnings.
  void fileFds;
  return result;
}
