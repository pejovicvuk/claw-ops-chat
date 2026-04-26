import { RingBuffer } from "../ring-buffer";
import { getAllSessionStatuses } from "../../session-status-store";
import { wsGetAllSessions, wsGetTotalEverConnected, wsSampleRates } from "../ws-session-store";
import type { WsSessionRow, WsSnapshot } from "../types";

const SERIES_LEN = 60;
const SAMPLE_INTERVAL_MS = 1000;

let activeSeries: RingBuffer | null = null;
let msgsInSeries: RingBuffer | null = null;
let msgsOutSeries: RingBuffer | null = null;

function ensureBuffers(): {
  active: RingBuffer;
  msgsIn: RingBuffer;
  msgsOut: RingBuffer;
} {
  if (!activeSeries) activeSeries = new RingBuffer(SERIES_LEN);
  if (!msgsInSeries) msgsInSeries = new RingBuffer(SERIES_LEN);
  if (!msgsOutSeries) msgsOutSeries = new RingBuffer(SERIES_LEN);
  return { active: activeSeries, msgsIn: msgsInSeries, msgsOut: msgsOutSeries };
}

export async function collectWs(): Promise<WsSnapshot> {
  const buffers = ensureBuffers();
  const sessions = wsGetAllSessions();
  const statuses = getAllSessionStatuses();
  const rates = wsSampleRates(SAMPLE_INTERVAL_MS);

  buffers.active.push(sessions.length);
  buffers.msgsIn.push(rates.msgsInPerSec);
  buffers.msgsOut.push(rates.msgsOutPerSec);

  const rows: WsSessionRow[] = sessions.map((meta) => {
    const status = statuses[meta.id]?.status;
    let state: WsSessionRow["state"];
    if (status === "thinking" || status === "tool_running") state = "busy";
    else if (status === "awaiting_permission" || status === "awaiting_input")
      state = "awaiting_permission";
    else if (status === "idle") state = "idle";
    else state = meta.clientCount === 0 ? "closing" : "idle";

    return {
      id: meta.id,
      state,
      clientCount: meta.clientCount,
      queueDepth: meta.queueDepth,
      pendingRequests: meta.pendingRequests,
      connectedAt: meta.connectedAt,
      lastActivityAt: meta.lastActivityAt,
      msgsIn: meta.msgsIn,
      msgsOut: meta.msgsOut,
      bytesIn: meta.bytesIn,
      bytesOut: meta.bytesOut,
      msgsInSeries: meta.msgsInRing.toArray(),
      msgsOutSeries: meta.msgsOutRing.toArray(),
      client: meta.client,
      ip: meta.ip,
    };
  });

  const snapshot: WsSnapshot = {
    active: sessions.length,
    totalEverConnected: wsGetTotalEverConnected(),
    msgsInPerSec: rates.msgsInPerSec,
    msgsOutPerSec: rates.msgsOutPerSec,
    bytesInPerSec: 0,
    bytesOutPerSec: 0,
    series: {
      active: buffers.active.toArray(),
      msgsInPerSec: buffers.msgsIn.toArray(),
      msgsOutPerSec: buffers.msgsOut.toArray(),
    },
    sessions: rows,
  };
  return snapshot;
}
