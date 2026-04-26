import { existsSync, statSync } from "fs";
import type { MonCapabilities } from "./types";

/**
 * Capability detection for the monitoring subsystem. Each section probes
 * what's reachable at startup and renders graceful empty states for
 * features that aren't enabled (Docker socket missing, /proc unmounted, etc.).
 *
 * Detection runs once on first call and caches — operators changing the
 * runtime environment must restart the server.
 */

const DOCKER_SOCKET_PATHS = ["/var/run/docker.sock", "/run/docker.sock"];

let cached: MonCapabilities | null = null;

export function detectCapabilities(): MonCapabilities {
  if (cached) return cached;

  const hostProcEnv = (process.env.HOST_PROC ?? "").trim() || null;
  const procPath = hostProcEnv ?? "/proc";
  const sysPath = (process.env.HOST_SYS ?? "").trim() || "/sys";

  cached = {
    docker: dockerSocketReachable(),
    proc: pathExistsAsDir(procPath),
    exposeGc: typeof globalThis.gc === "function",
    sys: pathExistsAsDir(sysPath),
    hostProcMount: hostProcEnv,
  };
  return cached;
}

/** Force re-detection — used by tests. */
export function __resetCapabilitiesCache(): void {
  cached = null;
}

export function getDockerSocketPath(): string | null {
  for (const p of DOCKER_SOCKET_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

function dockerSocketReachable(): boolean {
  return getDockerSocketPath() !== null;
}

function pathExistsAsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
