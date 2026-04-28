import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { getPushStore } from "@/lib/push/store";
import {
  ALL_EVENT_KINDS,
  ALL_FOCUS_BEHAVIORS,
  type BehaviorPreferences,
  type EventPreferences,
  type FocusBehavior,
} from "@/lib/push/types";

interface PatchBody {
  label?: string;
  events?: Partial<EventPreferences>;
  behavior?: Partial<BehaviorPreferences>;
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

interface RouteCtx {
  params: Promise<{ id: string }>;
}

async function patchHandler(request: Request, ctx: RouteCtx): Promise<Response> {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const { id } = await ctx.params;
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const patch: {
    label?: string;
    events?: Partial<EventPreferences>;
    behavior?: Partial<BehaviorPreferences>;
  } = {};
  if (typeof body.label === "string" && body.label.trim().length > 0) {
    patch.label = body.label.trim().slice(0, 80);
  }
  if (body.events) patch.events = sanitizeEvents(body.events);
  if (body.behavior) patch.behavior = sanitizeBehavior(body.behavior);
  const updated = await getPushStore().updatePreferences(session.email, id, patch);
  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    id: updated.id,
    label: updated.label,
    createdAt: updated.createdAt,
    lastSeenAt: updated.lastSeenAt,
    events: updated.events,
    behavior: updated.behavior,
  });
}

async function deleteHandler(request: Request, ctx: RouteCtx): Promise<Response> {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const { id } = await ctx.params;
  const removed = await getPushStore().remove(session.email, id);
  if (!removed) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}

export const PATCH = withAudit<RouteCtx>(
  { route: "/api/push/subscriptions/[id]", subjectFrom: () => null },
  patchHandler,
);

export const DELETE = withAudit<RouteCtx>(
  { route: "/api/push/subscriptions/[id]", subjectFrom: () => null },
  deleteHandler,
);
