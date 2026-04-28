import webPush, { type WebPushError } from "web-push";
import { getAuditWriter } from "../audit/writer";
import { recordSend } from "./diagnostics";
import { getPushStore } from "./store";
import { getVapidKeys } from "./vapid";
import type { DeviceRecord, PushEventKind, PushPayload } from "./types";

/**
 * Send a Web Push notification to every device a user has registered
 * for `eventKind`. Per-device failure is isolated; a 404/410 from the
 * upstream push service drops the dead subscription.
 *
 * Fire-and-forget for callers — the server never `await`s these.
 */
export async function sendToUser(
  email: string,
  payload: PushPayload,
  eventKind: PushEventKind,
): Promise<void> {
  // Touching this triggers `webPush.setVapidDetails(...)` lazily.
  getVapidKeys();
  const store = getPushStore();
  const targets: DeviceRecord[] = [];
  await store.forUserWithEvent(email, eventKind, (d) => targets.push(d));
  if (targets.length === 0) return;
  await Promise.all(targets.map((d) => sendOne(email, d, payload)));
}

/**
 * Send to every subscribed device for an event, regardless of which user
 * owns it. Used by cron-complete notifications where the report doesn't
 * carry an owner email and the app is single-user anyway.
 */
export async function sendToAll(payload: PushPayload, eventKind: PushEventKind): Promise<void> {
  getVapidKeys();
  const store = getPushStore();
  const targets: { email: string; device: DeviceRecord }[] = [];
  await store.forEachWithEvent(eventKind, (email, device) => {
    targets.push({ email, device });
  });
  if (targets.length === 0) return;
  await Promise.all(targets.map(({ email, device }) => sendOne(email, device, payload)));
}

async function sendOne(email: string, device: DeviceRecord, payload: PushPayload): Promise<void> {
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
      {
        endpoint: device.endpoint,
        keys: device.keys,
      },
      JSON.stringify(enriched),
      // 24h TTL — if the device is offline that long, drop the message.
      { TTL: 24 * 60 * 60 },
    );
    logSendResult(email, device, payload.kind, "sent");
  } catch (err) {
    const status = (err as WebPushError | null)?.statusCode;
    if (status === 404 || status === 410) {
      // Subscription is permanently gone (user reset notifications,
      // uninstalled the app, etc). Drop it from the store.
      try {
        await getPushStore().removeByEndpoint(device.endpoint);
      } catch {
        /* best-effort */
      }
      logSendResult(email, device, payload.kind, "dropped", `dead subscription (${status})`);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    logSendResult(email, device, payload.kind, "error", msg);
  }
}

function logSendResult(
  email: string,
  device: DeviceRecord,
  kind: PushEventKind,
  outcome: "sent" | "dropped" | "error",
  detail?: string,
): void {
  recordSend({
    ts: Date.now(),
    email,
    device: device.label,
    kind,
    outcome,
    detail,
  });
  getAuditWriter()
    .api({
      type: outcome === "error" ? "request_error" : "request_complete",
      severity: outcome === "error" ? "warn" : "info",
      actor: email,
      subject: `push:${kind} → ${device.label} (${outcome})`,
      durationMs: null,
      route: "/internal/push/send",
      method: "PUSH",
      statusCode: outcome === "error" ? 500 : 200,
      target: device.id,
      details: detail ? { detail } : {},
    })
    .catch(() => {});
}
