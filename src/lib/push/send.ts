import webPush, { type WebPushError } from "web-push";
import { getAuditWriter } from "../audit/writer";
import { recordSend } from "./diagnostics";
import { getPushStore } from "./store";
import { getVapidKeys } from "./vapid";
import type { DeviceRecord, PushEventKind, PushPayload } from "./types";

export type SendOutcome = "sent" | "dropped" | "error";

export interface SendResult {
  email: string;
  deviceId: string;
  deviceLabel: string;
  outcome: SendOutcome;
  /** Status code from the upstream push service when available. */
  statusCode?: number;
  /** Free-form detail (error message, "dead subscription (410)", etc.). */
  detail?: string;
}

/**
 * Send a Web Push notification to every device a user has registered
 * for `eventKind`. Per-device failure is isolated; 4xx responses from
 * the upstream push service drop the dead/stale subscription.
 *
 * Returns one `SendResult` per attempted device so callers (e.g. the
 * test endpoint) can surface per-device outcomes. Existing fire-and-
 * forget callers can ignore the resolved value.
 */
export async function sendToUser(
  email: string,
  payload: PushPayload,
  eventKind: PushEventKind,
): Promise<SendResult[]> {
  // Awaited so VAPID keys are loaded (env / file / generated) before any
  // sendNotification call. Previously this was fire-and-forget which
  // meant the very first push of a process lifetime could race with
  // VAPID initialisation.
  await getVapidKeys();
  const store = getPushStore();
  const targets: DeviceRecord[] = [];
  await store.forUserWithEvent(email, eventKind, (d) => targets.push(d));
  if (targets.length === 0) return [];
  return Promise.all(targets.map((d) => sendOne(email, d, payload)));
}

/**
 * Send to every subscribed device for an event, regardless of which user
 * owns it. Used by cron-complete notifications where the report doesn't
 * carry an owner email and the app is single-user anyway.
 */
export async function sendToAll(
  payload: PushPayload,
  eventKind: PushEventKind,
): Promise<SendResult[]> {
  await getVapidKeys();
  const store = getPushStore();
  const targets: { email: string; device: DeviceRecord }[] = [];
  await store.forEachWithEvent(eventKind, (email, device) => {
    targets.push({ email, device });
  });
  if (targets.length === 0) return [];
  return Promise.all(targets.map(({ email, device }) => sendOne(email, device, payload)));
}

/**
 * Classify a Web Push response. We treat:
 *
 *  - 2xx → sent.
 *  - 404, 410 → "dead subscription" (browser unsubscribed, app
 *    uninstalled, push channel terminated). Drop from store.
 *  - 401, 403 → "credential mismatch". With persistent VAPID keys this
 *    can only mean the subscription was bound to a different keypair
 *    (e.g. someone restored an old vapid-keys.json or wiped it). Drop
 *    so the user re-enables and re-binds to the current public key.
 *  - Anything else → "error" (transient or unknown).
 *
 * Exported so the test endpoint and unit tests can reuse the same
 * mapping the runtime uses.
 */
export function classifySendStatus(status: number | undefined): {
  outcome: SendOutcome;
  drop: boolean;
  detail?: string;
} {
  if (status === undefined) return { outcome: "error", drop: false };
  if (status >= 200 && status < 300) return { outcome: "sent", drop: false };
  if (status === 404 || status === 410) {
    return { outcome: "dropped", drop: true, detail: `dead subscription (${status})` };
  }
  if (status === 401 || status === 403) {
    return {
      outcome: "dropped",
      drop: true,
      detail: `credential mismatch (${status}) — VAPID key changed; re-enable on this device`,
    };
  }
  return { outcome: "error", drop: false, detail: `upstream HTTP ${status}` };
}

async function sendOne(
  email: string,
  device: DeviceRecord,
  payload: PushPayload,
): Promise<SendResult> {
  // Inject the per-device focus behavior so the SW can decide locally
  // without an IndexedDB read on the push critical path. Caller-supplied
  // focusBehavior on the payload (e.g. test endpoint forcing a value)
  // wins over the device default.
  const enriched: PushPayload = {
    ...payload,
    focusBehavior: payload.focusBehavior ?? device.behavior.focusBehavior,
  };
  try {
    await webPush.sendNotification(
      { endpoint: device.endpoint, keys: device.keys },
      JSON.stringify(enriched),
      // 24h TTL — if the device is offline that long, drop the message.
      { TTL: 24 * 60 * 60 },
    );
    return finalize(email, device, payload.kind, { outcome: "sent" });
  } catch (err) {
    const wpe = err as WebPushError | null;
    const status = wpe?.statusCode;
    const classified = classifySendStatus(status);
    if (classified.drop) {
      try {
        await getPushStore().removeByEndpoint(device.endpoint);
      } catch {
        /* best-effort */
      }
    }
    const detail =
      classified.detail ?? (err instanceof Error ? err.message : String(err)) ?? undefined;
    return finalize(email, device, payload.kind, {
      outcome: classified.outcome,
      detail,
      statusCode: status,
    });
  }
}

function finalize(
  email: string,
  device: DeviceRecord,
  kind: PushEventKind,
  result: { outcome: SendOutcome; detail?: string; statusCode?: number },
): SendResult {
  recordSend({
    ts: Date.now(),
    email,
    device: device.label,
    kind,
    outcome: result.outcome,
    statusCode: result.statusCode,
    detail: result.detail,
  });
  getAuditWriter()
    .api({
      type: result.outcome === "error" ? "request_error" : "request_complete",
      severity: result.outcome === "error" ? "warn" : "info",
      actor: email,
      subject: `push:${kind} → ${device.label} (${result.outcome})`,
      durationMs: null,
      route: "/internal/push/send",
      method: "PUSH",
      statusCode: result.statusCode ?? (result.outcome === "error" ? 500 : 200),
      target: device.id,
      details: result.detail
        ? { detail: result.detail, statusCode: result.statusCode }
        : { statusCode: result.statusCode },
    })
    .catch(() => {});
  return {
    email,
    deviceId: device.id,
    deviceLabel: device.label,
    outcome: result.outcome,
    statusCode: result.statusCode,
    detail: result.detail,
  };
}
