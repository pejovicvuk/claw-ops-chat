"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DetectionResult,
  Framework,
  ListResponse,
  RunningServer,
  StopResponse,
} from "./types";

/**
 * React hook that the PreviewWindow uses to drive its Start / Stop
 * buttons + framework chip + log panel.
 *
 * - On mount: hits `GET /api/dev-server/detect` to populate the
 *   framework + default port.
 * - On a 5 s tick (while the window is open): hits
 *   `GET /api/dev-server` and finds the entry matching this
 *   `(projectSlug, itemSlug, port)` tuple. The poll is cheap (single
 *   small JSON), idempotent, and is the simplest way to keep the UI
 *   in sync across multiple PreviewWindows pointed at the same port.
 *   A WS would be marginally faster but the dev-server lifecycle is
 *   user-paced, not millisecond-paced.
 *
 * Returns:
 *   - `status`: "idle" | "starting" | "running" | "stopping" | "error"
 *   - `runningServer`: the matching `RunningServer` if any
 *   - `framework`: the detected framework (used for the chip)
 *   - `defaultPort`: the framework's default port (used to seed the
 *     port input on a fresh window)
 *   - `recentLogs`: last ~50 lines of stdout/stderr from the running
 *     server (empty array when nothing is running)
 *   - `start()` / `stop()`: action callbacks
 *   - `lastError`: human-readable last error message, or null
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/chat";
const POLL_INTERVAL_MS = 5_000;

export type DevServerStatus = "idle" | "starting" | "running" | "stopping" | "error";

export interface UseDevServerResult {
  status: DevServerStatus;
  runningServer: RunningServer | null;
  framework: Framework | null;
  defaultPort: number | null;
  recentLogs: string[];
  lastError: string | null;
  /** Spawn a dev server on `port` for this item. Fires immediately. */
  start: () => Promise<void>;
  /** Kill the currently-tracked server. No-op if nothing is running. */
  stop: () => Promise<void>;
  /** Force an immediate poll instead of waiting for the next interval. */
  refresh: () => Promise<void>;
}

export function useDevServer({
  projectSlug,
  itemSlug,
  port,
}: {
  projectSlug: string;
  itemSlug: string;
  port: number;
}): UseDevServerResult {
  const [status, setStatus] = useState<DevServerStatus>("idle");
  const [runningServer, setRunningServer] = useState<RunningServer | null>(null);
  const [framework, setFramework] = useState<Framework | null>(null);
  const [defaultPort, setDefaultPort] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // The poll loop reads these via refs so changes don't restart the
  // interval (which would skew the cadence on every keystroke).
  const portRef = useRef(port);
  const projectSlugRef = useRef(projectSlug);
  const itemSlugRef = useRef(itemSlug);
  useEffect(() => {
    portRef.current = port;
    projectSlugRef.current = projectSlug;
    itemSlugRef.current = itemSlug;
  }, [port, projectSlug, itemSlug]);

  /** Detection — populates the framework chip + default port suggestion. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${BASE_PATH}/api/dev-server/detect?projectSlug=${encodeURIComponent(projectSlug)}&itemSlug=${encodeURIComponent(itemSlug)}`,
          { credentials: "include" },
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as DetectionResult;
        if (cancelled) return;
        setFramework(data.framework);
        setDefaultPort(data.defaultPort);
      } catch {
        /* detection is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectSlug, itemSlug]);

  /**
   * Polls the registry. Sets `status` based on whether a record exists
   * for our (project, item, port) tuple AND whether `readyAt` has been
   * stamped (server is "starting" until then).
   */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/dev-server`, { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as ListResponse;
      const match = data.servers.find(
        (s) =>
          s.projectSlug === projectSlugRef.current &&
          s.itemSlug === itemSlugRef.current &&
          s.port === portRef.current,
      );
      setRunningServer(match ?? null);
      setStatus((current) => {
        if (current === "starting" && !match) return current; // wait for it to appear
        if (current === "stopping" && match) return current; // wait for it to disappear
        if (!match) return "idle";
        return match.readyAt !== null ? "running" : "starting";
      });
    } catch {
      /* poll is best-effort; don't surface as user-visible error */
    }
  }, []);

  useEffect(() => {
    // Kick off immediately + every POLL_INTERVAL_MS thereafter.
    void refresh();
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const start = useCallback(async () => {
    setStatus("starting");
    setLastError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/dev-server/start`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectSlug, itemSlug, port }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `Start failed (HTTP ${res.status})`);
      }
      const created = (await res.json()) as RunningServer;
      setRunningServer(created);
      // Force a quick poll so we pick up readyAt as soon as it's set.
      void refresh();
    } catch (err) {
      setStatus("error");
      setLastError(err instanceof Error ? err.message : "Start failed");
    }
  }, [projectSlug, itemSlug, port, refresh]);

  const stop = useCallback(async () => {
    if (!runningServer) return;
    setStatus("stopping");
    setLastError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/dev-server/stop`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: runningServer.id }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `Stop failed (HTTP ${res.status})`);
      }
      // We already know it's gone — mark idle eagerly; the next poll
      // will reconcile if anything went sideways.
      // Treat the response shape (`StopResponse`) as a sanity check.
      (await res.json()) as StopResponse;
      setRunningServer(null);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setLastError(err instanceof Error ? err.message : "Stop failed");
    }
  }, [runningServer]);

  return {
    status,
    runningServer,
    framework,
    defaultPort,
    recentLogs: runningServer?.lastLogs ?? [],
    lastError,
    start,
    stop,
    refresh,
  };
}
