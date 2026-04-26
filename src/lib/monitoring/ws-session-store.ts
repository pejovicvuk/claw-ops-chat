import { RingBuffer } from "./ring-buffer";

/**
 * Globally-anchored registry of WebSocket-session metadata used by the
 * monitoring WS collector. server.ts writes lifecycle events into this
 * store; the monitoring collector reads them on each tick.
 *
 * Mirrors the `session-status-store` pattern (globalThis anchor) so the
 * Next.js standalone build's duplicate module graphs share one instance.
 */

const SERIES_LEN = 60;

export interface WsSessionMeta {
  id: string;
  clientCount: number;
  queueDepth: number;
  pendingRequests: number;
  connectedAt: number;
  lastActivityAt: number;
  msgsIn: number;
  msgsOut: number;
  bytesIn: number;
  bytesOut: number;
  /** Bytes/messages sampled per tick — populated externally. */
  msgsInRing: RingBuffer;
  msgsOutRing: RingBuffer;
  /** Snapshot of the last sampled values to compute deltas. */
  lastMsgsInSample: number;
  lastMsgsOutSample: number;
  client?: string;
  ip?: string;
}

declare global {
  var __clawWsSessionStore: Map<string, WsSessionMeta> | undefined;
  var __clawWsTotalEverConnected: { value: number } | undefined;
}

const store: Map<string, WsSessionMeta> =
  globalThis.__clawWsSessionStore ??
  (globalThis.__clawWsSessionStore = new Map<string, WsSessionMeta>());

const totals: { value: number } =
  globalThis.__clawWsTotalEverConnected ?? (globalThis.__clawWsTotalEverConnected = { value: 0 });

export function wsRegisterSession(opts: {
  id: string;
  client?: string;
  ip?: string;
  clientCount: number;
}): void {
  const existing = store.get(opts.id);
  if (existing) {
    existing.clientCount = opts.clientCount;
    existing.lastActivityAt = Date.now();
    return;
  }
  store.set(opts.id, {
    id: opts.id,
    clientCount: opts.clientCount,
    queueDepth: 0,
    pendingRequests: 0,
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
    msgsIn: 0,
    msgsOut: 0,
    bytesIn: 0,
    bytesOut: 0,
    msgsInRing: new RingBuffer(SERIES_LEN),
    msgsOutRing: new RingBuffer(SERIES_LEN),
    lastMsgsInSample: 0,
    lastMsgsOutSample: 0,
    client: opts.client,
    ip: opts.ip,
  });
  totals.value += 1;
}

export function wsUpdateSession(
  id: string,
  patch: Partial<
    Pick<
      WsSessionMeta,
      "clientCount" | "queueDepth" | "pendingRequests" | "lastActivityAt" | "client" | "ip"
    >
  >,
): void {
  const meta = store.get(id);
  if (!meta) return;
  if (patch.clientCount !== undefined) meta.clientCount = patch.clientCount;
  if (patch.queueDepth !== undefined) meta.queueDepth = patch.queueDepth;
  if (patch.pendingRequests !== undefined) meta.pendingRequests = patch.pendingRequests;
  if (patch.lastActivityAt !== undefined) meta.lastActivityAt = patch.lastActivityAt;
  if (patch.client !== undefined) meta.client = patch.client;
  if (patch.ip !== undefined) meta.ip = patch.ip;
}

export function wsRecordIncoming(id: string, bytes: number): void {
  const meta = store.get(id);
  if (!meta) return;
  meta.msgsIn += 1;
  meta.bytesIn += bytes;
  meta.lastActivityAt = Date.now();
}

export function wsRecordOutgoing(id: string, bytes: number): void {
  const meta = store.get(id);
  if (!meta) return;
  meta.msgsOut += 1;
  meta.bytesOut += bytes;
  meta.lastActivityAt = Date.now();
}

export function wsRemoveSession(id: string): void {
  store.delete(id);
}

export function wsGetAllSessions(): WsSessionMeta[] {
  return Array.from(store.values());
}

export function wsGetSession(id: string): WsSessionMeta | null {
  return store.get(id) ?? null;
}

export function wsGetTotalEverConnected(): number {
  return totals.value;
}

/**
 * Sample current per-second message rates by computing the delta since
 * last sample. Called from the WS collector tick.
 */
export function wsSampleRates(intervalMs: number): {
  msgsInPerSec: number;
  msgsOutPerSec: number;
} {
  let msgsIn = 0;
  let msgsOut = 0;
  const factor = 1000 / Math.max(1, intervalMs);
  for (const meta of store.values()) {
    const dIn = meta.msgsIn - meta.lastMsgsInSample;
    const dOut = meta.msgsOut - meta.lastMsgsOutSample;
    meta.lastMsgsInSample = meta.msgsIn;
    meta.lastMsgsOutSample = meta.msgsOut;
    const inRate = Math.max(0, dIn) * factor;
    const outRate = Math.max(0, dOut) * factor;
    meta.msgsInRing.push(inRate);
    meta.msgsOutRing.push(outRate);
    msgsIn += inRate;
    msgsOut += outRate;
  }
  return { msgsInPerSec: msgsIn, msgsOutPerSec: msgsOut };
}
