import { randomUUID } from "node:crypto";
import type { Page } from "playwright-core";
import { getAuditWriter } from "../audit/writer";

/**
 * In-memory registry of active preview-stream connections (issue #134).
 *
 * Two responsibilities live here:
 *   1. Concurrent-preview cap — `tryRegisterPreview` returns null when
 *      we're at PREVIEW_MAX_ACTIVE, so the WS handler can reject with a
 *      `too_many_active` error before allocating Chromium resources.
 *   2. Per-preview heartbeat — `startHealthMonitor` pings the page
 *      every HEARTBEAT_INTERVAL_MS via `page.evaluate(() => 1)`. After
 *      HEARTBEAT_FAILURE_THRESHOLD consecutive failures (typically a
 *      stuck tab — e.g. an `about:hang` page or a runaway script) it
 *      invokes `onStuck` so the handler can kill + auto-restart the
 *      page. The 5 s × 3 cadence matches the issue's "within 15 s"
 *      acceptance target.
 *
 * Audit events fire through `audit.preview()` at register / unregister
 * time. The handler is responsible for emitting `reconnect` and
 * `resource_kill` itself, since only it knows when the new pipeline is
 * actually streaming.
 */

const DEFAULT_MAX_ACTIVE = 4;
const MIN_MAX_ACTIVE = 1;
const MAX_MAX_ACTIVE = 256;

const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_TIMEOUT_MS = 3_000;
const HEARTBEAT_FAILURE_THRESHOLD = 3;

function readMaxActive(): number {
  const raw = process.env.PREVIEW_MAX_ACTIVE;
  if (!raw) return DEFAULT_MAX_ACTIVE;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_MAX_ACTIVE || parsed > MAX_MAX_ACTIVE) {
    return DEFAULT_MAX_ACTIVE;
  }
  return parsed;
}

/** Read on each register so tests / hot-reload pick up env changes. */
export function previewMaxActive(): number {
  return readMaxActive();
}

export type PreviewCodec = "jpeg" | "h264" | "webrtc";

export interface PreviewMeta {
  projectSlug: string;
  itemSlug: string;
  port: number;
  actorEmail: string;
  codec: PreviewCodec;
}

interface ActivePreviewState {
  id: string;
  meta: PreviewMeta;
  openedAt: number;
  lastHeartbeatAt: number | null;
  consecutiveFailures: number;
  framesSent: number;
  bytesSent: number;
  restartCount: number;
}

export interface PreviewSnapshot {
  id: string;
  projectSlug: string;
  itemSlug: string;
  port: number;
  actorEmail: string;
  codec: PreviewCodec;
  openedAt: number;
  lastHeartbeatAt: number | null;
  consecutiveFailures: number;
  framesSent: number;
  bytesSent: number;
  restartCount: number;
}

export interface PreviewRegistration {
  id: string;
  unregister(): void;
  recordHeartbeat(success: boolean): void;
  recordFrame(byteCount: number): void;
  /** Audit the kill of a stuck page. Caller is responsible for the
   *  actual `page.close()` + re-acquire. */
  recordResourceKill(reason: string): void;
  /** Audit a successful pipeline reconnect (called after a fresh page
   *  + screencast are streaming again). Increments `restartCount`. */
  recordReconnect(reason: string): void;
  updateCodec(codec: PreviewCodec): void;
}

const registry = new Map<string, ActivePreviewState>();

function subjectFor(meta: PreviewMeta): string {
  return `${meta.projectSlug}/${meta.itemSlug}:${meta.port}`;
}

export function tryRegisterPreview(meta: PreviewMeta): PreviewRegistration | null {
  if (registry.size >= readMaxActive()) return null;
  const id = randomUUID();
  const state: ActivePreviewState = {
    id,
    meta: { ...meta },
    openedAt: Date.now(),
    lastHeartbeatAt: null,
    consecutiveFailures: 0,
    framesSent: 0,
    bytesSent: 0,
    restartCount: 0,
  };
  registry.set(id, state);

  const writer = getAuditWriter();
  writer
    .preview({
      type: "open",
      severity: "info",
      actor: meta.actorEmail,
      subject: subjectFor(meta),
      durationMs: null,
      details: { codec: meta.codec },
      previewId: id,
      projectSlug: meta.projectSlug,
      itemSlug: meta.itemSlug,
      port: meta.port,
      codec: meta.codec,
    })
    .catch(() => {});

  let unregistered = false;
  return {
    id,
    unregister(): void {
      if (unregistered) return;
      unregistered = true;
      const s = registry.get(id);
      if (!s) return;
      registry.delete(id);
      const durationMs = Date.now() - s.openedAt;
      writer
        .preview({
          type: "close",
          severity: "info",
          actor: s.meta.actorEmail,
          subject: subjectFor(s.meta),
          durationMs,
          details: {
            framesSent: s.framesSent,
            bytesSent: s.bytesSent,
            restartCount: s.restartCount,
          },
          previewId: id,
          projectSlug: s.meta.projectSlug,
          itemSlug: s.meta.itemSlug,
          port: s.meta.port,
          codec: s.meta.codec,
        })
        .catch(() => {});
    },
    recordHeartbeat(success: boolean): void {
      const s = registry.get(id);
      if (!s) return;
      if (success) {
        s.lastHeartbeatAt = Date.now();
        s.consecutiveFailures = 0;
      } else {
        s.consecutiveFailures += 1;
      }
    },
    recordFrame(byteCount: number): void {
      const s = registry.get(id);
      if (!s) return;
      s.framesSent += 1;
      s.bytesSent += byteCount;
    },
    recordResourceKill(reason: string): void {
      const s = registry.get(id);
      if (!s) return;
      writer
        .preview({
          type: "resource_kill",
          severity: "warn",
          actor: s.meta.actorEmail,
          subject: subjectFor(s.meta),
          durationMs: null,
          details: { reason, consecutiveFailures: s.consecutiveFailures },
          previewId: id,
          projectSlug: s.meta.projectSlug,
          itemSlug: s.meta.itemSlug,
          port: s.meta.port,
          codec: s.meta.codec,
          reason,
        })
        .catch(() => {});
    },
    recordReconnect(reason: string): void {
      const s = registry.get(id);
      if (!s) return;
      s.restartCount += 1;
      s.consecutiveFailures = 0;
      s.lastHeartbeatAt = Date.now();
      writer
        .preview({
          type: "reconnect",
          severity: "info",
          actor: s.meta.actorEmail,
          subject: subjectFor(s.meta),
          durationMs: null,
          details: { reason, restartCount: s.restartCount },
          previewId: id,
          projectSlug: s.meta.projectSlug,
          itemSlug: s.meta.itemSlug,
          port: s.meta.port,
          codec: s.meta.codec,
          reason,
        })
        .catch(() => {});
    },
    updateCodec(codec: PreviewCodec): void {
      const s = registry.get(id);
      if (!s) return;
      const previous = s.meta.codec;
      s.meta.codec = codec;
      if (previous !== codec) {
        writer
          .preview({
            type: "codec_fallback",
            severity: "info",
            actor: s.meta.actorEmail,
            subject: subjectFor(s.meta),
            durationMs: null,
            details: { from: previous, to: codec },
            previewId: id,
            projectSlug: s.meta.projectSlug,
            itemSlug: s.meta.itemSlug,
            port: s.meta.port,
            codec,
          })
          .catch(() => {});
      }
    },
  };
}

export function getActivePreviews(): PreviewSnapshot[] {
  return Array.from(registry.values()).map((s) => ({
    id: s.id,
    projectSlug: s.meta.projectSlug,
    itemSlug: s.meta.itemSlug,
    port: s.meta.port,
    actorEmail: s.meta.actorEmail,
    codec: s.meta.codec,
    openedAt: s.openedAt,
    lastHeartbeatAt: s.lastHeartbeatAt,
    consecutiveFailures: s.consecutiveFailures,
    framesSent: s.framesSent,
    bytesSent: s.bytesSent,
    restartCount: s.restartCount,
  }));
}

export function getActivePreviewCount(): number {
  return registry.size;
}

export interface HealthMonitorOptions {
  /**
   * Fired when HEARTBEAT_FAILURE_THRESHOLD consecutive heartbeats have
   * failed. Caller is responsible for killing the stuck page, bringing
   * up a fresh one, and (on success) calling `registration.recordRestart`
   * which audits the `resource_kill` / `reconnect` lifecycle.
   *
   * The monitor resets `consecutiveFailures` before calling so a long
   * restart can't double-fire `onStuck`.
   */
  onStuck: (reason: string) => Promise<void> | void;
}

export interface HealthMonitorHandle {
  stop(): void;
}

export function startHealthMonitor(
  registration: PreviewRegistration,
  page: Page,
  opts: HealthMonitorOptions,
): HealthMonitorHandle {
  let stopped = false;
  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const ok = await pingPage(page);
      registration.recordHeartbeat(ok);
      if (ok) return;
      const s = registry.get(registration.id);
      if (!s) return;
      if (s.consecutiveFailures >= HEARTBEAT_FAILURE_THRESHOLD) {
        // Reset BEFORE awaiting onStuck so a stalled restart doesn't
        // re-arm the failure counter on the next tick.
        s.consecutiveFailures = 0;
        try {
          await opts.onStuck("heartbeat_timeout");
        } catch {
          /* onStuck owns its own error reporting */
        }
      }
    } finally {
      inFlight = false;
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, HEARTBEAT_INTERVAL_MS);
  interval.unref?.();

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
    },
  };
}

async function pingPage(page: Page): Promise<boolean> {
  let timer: NodeJS.Timeout | null = null;
  try {
    const result = await Promise.race<number>([
      page.evaluate(() => 1),
      new Promise<number>((_, reject) => {
        timer = setTimeout(() => reject(new Error("heartbeat timeout")), HEARTBEAT_TIMEOUT_MS);
      }),
    ]);
    return result === 1;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Test-only: clear registry between cases. */
export function _resetForTests(): void {
  registry.clear();
}

export const __INTERNAL = {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  HEARTBEAT_FAILURE_THRESHOLD,
  DEFAULT_MAX_ACTIVE,
};
