import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { navUrls } from "@/lib/nav-urls";
import { sendToUser } from "@/lib/push/send";
import {
  ALL_EVENT_KINDS,
  ALL_FOCUS_BEHAVIORS,
  type FocusBehavior,
  type PushEventKind,
  type PushPayload,
} from "@/lib/push/types";

const TEST_PAYLOADS: Record<PushEventKind, Omit<PushPayload, "kind">> = {
  turnComplete: {
    title: "Claw Chat — turn complete (test)",
    body: "If you see this, turn-complete notifications are wired correctly.",
    url: navUrls.chatRoot(),
  },
  permissionRequest: {
    title: "Claw Chat — permission request (test)",
    body: "If you see this, approval prompts will reach this device.",
    url: navUrls.chatRoot(),
  },
  error: {
    title: "Claw Chat — error (test)",
    body: "If you see this, error alerts will reach this device.",
    url: navUrls.chatRoot(),
  },
  cronComplete: {
    title: "Claw Chat — report finished (test)",
    body: "If you see this, scheduled-report alerts will reach this device.",
    url: navUrls.chatRoot(),
  },
  monitoringAlert: {
    title: "Claw Chat — monitoring alert (test)",
    body: "If you see this, monitoring alerts will reach this device.",
    url: navUrls.chatRoot(),
  },
};

function isPushEventKind(value: string | null): value is PushEventKind {
  return value !== null && (ALL_EVENT_KINDS as string[]).includes(value);
}

async function postHandler(request: Request): Promise<Response> {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const url = new URL(request.url);
  const kindParam = url.searchParams.get("kind");
  const kind: PushEventKind = isPushEventKind(kindParam) ? kindParam : "turnComplete";
  // chatId / behavior overrides let the user exercise the smartChat
  // decision tree end-to-end (focused tab on the same chat → in-app
  // toast; different chat → system notification). When chatId is
  // supplied we drop forceShow so the SW actually consults focus +
  // active-chat instead of bypassing the suppression check.
  const chatId = url.searchParams.get("chatId") ?? undefined;
  const behaviorParam = url.searchParams.get("focusBehavior");
  const focusBehavior: FocusBehavior | undefined =
    behaviorParam && (ALL_FOCUS_BEHAVIORS as string[]).includes(behaviorParam)
      ? (behaviorParam as FocusBehavior)
      : undefined;
  const exercising = !!(chatId || focusBehavior);
  // forceShow: when the request is just "send a test", we keep the old
  // behavior of bypassing focus suppression so the user on the settings
  // page can verify OS-level delivery without alt-tabbing. When the
  // caller explicitly asks for a chat-aware test, defer to the real
  // path so smartChat / suppress can be observed.
  const payload: PushPayload = {
    ...TEST_PAYLOADS[kind],
    kind,
    chatId,
    focusBehavior,
    forceShow: !exercising,
  };
  // Awaited so the UI can show real per-device counts — fire-and-forget
  // (or a flat `{ok:true}`) would always look successful even when every
  // upstream send failed. The previous version masked the VAPID-key
  // breakage that triggered this fix.
  const results = await sendToUser(session.email, payload, kind);
  const counts = {
    attempted: results.length,
    sent: results.filter((r) => r.outcome === "sent").length,
    dropped: results.filter((r) => r.outcome === "dropped").length,
    errored: results.filter((r) => r.outcome === "error").length,
  };
  return Response.json({
    ok: counts.errored === 0 && counts.dropped === 0,
    kind,
    ...counts,
    devices: results.map((r) => ({
      label: r.deviceLabel,
      outcome: r.outcome,
      statusCode: r.statusCode,
      detail: r.detail,
    })),
  });
}

export const POST = withAudit({ route: "/api/push/test", subjectFrom: () => null }, postHandler);
