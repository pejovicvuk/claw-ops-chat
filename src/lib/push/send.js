"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendToUser = sendToUser;
exports.sendToAll = sendToAll;
const web_push_1 = __importDefault(require("web-push"));
const writer_1 = require("../audit/writer");
const store_1 = require("./store");
const vapid_1 = require("./vapid");
/**
 * Send a Web Push notification to every device a user has registered
 * for `eventKind`. Per-device failure is isolated; a 404/410 from the
 * upstream push service drops the dead subscription.
 *
 * Fire-and-forget for callers — the server never `await`s these.
 */
async function sendToUser(email, payload, eventKind) {
    // Touching this triggers `webPush.setVapidDetails(...)` lazily.
    (0, vapid_1.getVapidKeys)();
    const store = (0, store_1.getPushStore)();
    const targets = [];
    await store.forUserWithEvent(email, eventKind, (d) => targets.push(d));
    if (targets.length === 0)
        return;
    await Promise.all(targets.map((d) => sendOne(email, d, payload)));
}
/**
 * Send to every subscribed device for an event, regardless of which user
 * owns it. Used by cron-complete notifications where the report doesn't
 * carry an owner email and the app is single-user anyway.
 */
async function sendToAll(payload, eventKind) {
    (0, vapid_1.getVapidKeys)();
    const store = (0, store_1.getPushStore)();
    const targets = [];
    await store.forEachWithEvent(eventKind, (email, device) => {
        targets.push({ email, device });
    });
    if (targets.length === 0)
        return;
    await Promise.all(targets.map(({ email, device }) => sendOne(email, device, payload)));
}
async function sendOne(email, device, payload) {
    try {
        await web_push_1.default.sendNotification({
            endpoint: device.endpoint,
            keys: device.keys,
        }, JSON.stringify(payload), 
        // 24h TTL — if the device is offline that long, drop the message.
        { TTL: 24 * 60 * 60 });
    }
    catch (err) {
        const status = err?.statusCode;
        if (status === 404 || status === 410) {
            // Subscription is permanently gone (user reset notifications,
            // uninstalled the app, etc). Drop it from the store.
            try {
                await (0, store_1.getPushStore)().removeByEndpoint(device.endpoint);
            }
            catch {
                /* best-effort */
            }
            logSendResult(email, device, payload.kind, "dropped", `dead subscription (${status})`);
            return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        logSendResult(email, device, payload.kind, "error", msg);
    }
}
function logSendResult(email, device, kind, outcome, detail) {
    (0, writer_1.getAuditWriter)()
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
        .catch(() => { });
}
