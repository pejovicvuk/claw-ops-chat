import webPush, { type WebPushError } from "web-push";
import { getAuditWriter } from "../audit/writer";
import { recordSend } from "./diagnostics";
import { getPushStore } from "./store";
import { getVapidKeys } from "./vapid";
import type { DeviceRecord, PushEventKind, PushPayload } from "./types";

/**
 * In-process event hook fired whenever a notification is dispatched,
 * regardless of push delivery outcome. Used by the global WebSocket
 * notification channel in server.ts so connected clients always receive
 * an in-app toast even when the OS suppresses the system notification.
 */
type DispatchListener = (payload: PushPayload) => void;
const dispatchListeners = new Set<DispatchListener>();

export function onNotificationDispatched(fn: DispatchListener): () => void {
  dispatchListeners.add(fn);
  return () => dispatchListeners.delete(fn);
}

function fireDispatch(payload: PushPayload): void {
  dispatchListeners.forEach((fn) => fn(payload));
}

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
  // Fire the in-app channel immediately, before any push attempt, so
  // connected clients always get a toast even when push is broken or the
  // OS suppresses the system notification. Skip closeOnly signals — those
  // are internal housekeeping, not user-visible events.
  if (!payload.closeOnly) fireDispatch(payload);
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
  if (!payload.closeOnly) fireDispatch(payload);
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
  await sendOneAttempt(email, device, enriched, 0);
}

async function sendOneAttempt(
  email: string,
  device: DeviceRecord,
  enriched: PushPayload,
  attempt: number,
): Promise<void> {
  try {
    await webPush.sendNotification(
      { endpoint: device.endpoint, keys: device.keys },
      JSON.stringify(enriched),
      // 24h TTL — if the device is offline that long, drop the message.
      { TTL: 24 * 60 * 60 },
    );
    logSendResult(email, device, enriched.kind, "sent");
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
      logSendResult(email, device, enriched.kind, "dropped", `dead subscription (${status})`);
      return;
    }
    // Rate-limit (429) or push-service error (5xx): retry up to 2 times
    // with exponential backoff. Any other error (auth, bad request, etc.)
    // is not retriable and is logged immediately.
    if (attempt < 2 && (status === 429 || (status !== undefined && status >= 500))) {
      const delayMs = attempt === 0 ? 5_000 : 30_000;
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      return sendOneAttempt(email, device, enriched, attempt + 1);
    }
    const msg = err instanceof Error ? err.message : String(err);
    logSendResult(email, device, enriched.kind, "error", msg);
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
