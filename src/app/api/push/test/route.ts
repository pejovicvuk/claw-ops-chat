import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { navUrls } from "@/lib/nav-urls";
import { sendToUser } from "@/lib/push/send";
import { ALL_EVENT_KINDS, type PushEventKind, type PushPayload } from "@/lib/push/types";

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
  const payload: PushPayload = { ...TEST_PAYLOADS[kind], kind };
  // Awaited so the UI can show a real success/failure toast — fire-and-
  // forget would always look successful even when zero devices delivered.
  await sendToUser(session.email, payload, kind);
  return Response.json({ ok: true, kind });
}

export const POST = withAudit({ route: "/api/push/test", subjectFrom: () => null }, postHandler);
