import si from "systeminformation";
import { scrubCmdline, scrubProcessName } from "../scrub";
import type { ProcessesSnapshot, ProcessRow } from "../types";

const MAX_ROWS = 200;

export async function collectProcesses(): Promise<ProcessesSnapshot> {
  try {
    const list = await si.processes();
    const procs = list.list ?? [];
    const sorted = [...procs].sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0)).slice(0, MAX_ROWS);
    const rows: ProcessRow[] = sorted.map((p) => ({
      pid: p.pid,
      ppid: p.parentPid ?? 0,
      user: p.user ?? "",
      name: scrubProcessName(p.name ?? ""),
      cmdline: scrubCmdline(p.command ?? p.path ?? ""),
      cpuPct: Math.round((p.cpu ?? 0) * 10) / 10,
      memBytes: Math.round(((p.memRss ?? 0) || 0) * 1024),
      threads: 0,
      state: typeof p.state === "string" ? p.state : "S",
      startTimeMs: p.started ? Date.parse(String(p.started)) : null,
    }));
    const zombies = procs.filter(
      (p) => typeof p.state === "string" && p.state.toUpperCase().includes("Z"),
    ).length;
    return {
      rows,
      totalProcs: procs.length,
      zombieCount: zombies,
      available: true,
    };
  } catch (err) {
    return {
      rows: [],
      totalProcs: 0,
      zombieCount: 0,
      available: false,
      reason: err instanceof Error ? err.message : "process listing failed",
    };
  }
}
