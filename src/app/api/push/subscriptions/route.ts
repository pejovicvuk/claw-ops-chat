import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { getPushStore } from "@/lib/push/store";
import {
  ALL_EVENT_KINDS,
  ALL_FOCUS_BEHAVIORS,
  type BehaviorPreferences,
  type EventPreferences,
  type FocusBehavior,
  type PushSubscriptionInput,
} from "@/lib/push/types";

interface PostBody {
  subscription?: PushSubscriptionInput;
  label?: string;
  events?: Partial<EventPreferences>;
  behavior?: Partial<BehaviorPreferences>;
}

function isValidSubscription(s: unknown): s is PushSubscriptionInput {
  if (!s || typeof s !== "object") return false;
  const sub = s as Record<string, unknown>;
  if (typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://")) return false;
  if (!sub.keys || typeof sub.keys !== "object") return false;
  const keys = sub.keys as Record<string, unknown>;
  return typeof keys.p256dh === "string" && typeof keys.auth === "string";
}

function sanitizeEvents(raw: unknown): Partial<EventPreferences> {
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<EventPreferences> = {};
  for (const k of ALL_EVENT_KINDS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

function sanitizeBehavior(raw: unknown): Partial<BehaviorPreferences> {
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<BehaviorPreferences> = {};
  const v = (raw as Record<string, unknown>).focusBehavior;
  if (typeof v === "string" && (ALL_FOCUS_BEHAVIORS as string[]).includes(v)) {
    out.focusBehavior = v as FocusBehavior;
  }
  return out;
}

async function getHandler(request: Request): Promise<Response> {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const url = new URL(request.url);
  const currentEndpoint = url.searchParams.get("currentEndpoint") ?? undefined;
  const devices = await getPushStore().listSummary(session.email, currentEndpoint);
  const thisDeviceId = devices.find((d) => d.isThisDevice)?.id ?? null;
  return Response.json({ devices, thisDeviceId });
}

async function postHandler(request: Request): Promise<Response> {
  const session = extractSession(request);
  if (!session) return unauthorized();
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isValidSubscription(body.subscription)) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }
  const label =
    typeof body.label === "string" && body.label.trim().length > 0
      ? body.label.trim().slice(0, 80)
      : "Unknown device";
  const events = sanitizeEvents(body.events);
  const behavior = sanitizeBehavior(body.behavior);
  const record = await getPushStore().upsert(
    session.email,
    body.subscription,
    label,
    events,
    behavior,
  );
  return Response.json({
    id: record.id,
    label: record.label,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    events: record.events,
    behavior: record.behavior,
  });
}

async function deleteHandler(request: Request): Promise<Response> {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const url = new URL(request.url);
  if (url.searchParams.get("all") === "true") {
    const removed = await getPushStore().clear(session.email);
    return Response.json({ removed });
  }
  return Response.json({ error: "id or all=true required" }, { status: 400 });
}

export const GET = withAudit(
  { route: "/api/push/subscriptions", subjectFrom: () => null },
  getHandler,
);

export const POST = withAudit(
  { route: "/api/push/subscriptions", subjectFrom: () => null },
  postHandler,
);

export const DELETE = withAudit(
  { route: "/api/push/subscriptions", subjectFrom: () => null },
  deleteHandler,
);
