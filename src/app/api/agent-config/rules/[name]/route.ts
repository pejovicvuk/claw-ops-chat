import { extractSession, unauthorized } from "@/lib/auth-server";
import {
  DEPRECATION_HEADER,
  LegacyAdapterError,
  deleteLegacyRule,
  readLegacyRule,
  updateLegacyRule,
} from "@/lib/agent-config-legacy-adapter";

/**
 * **Deprecated.** Reads/writes from `/root/.memory/global/rules/<name>.md`
 * via the legacy adapter. New callers should use `/api/memory/global/<path>`
 * instead. Slated for removal in a follow-up PR.
 */

function withDeprecation(res: Response): Response {
  for (const [k, v] of Object.entries(DEPRECATION_HEADER)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const { name } = await params;
  try {
    const record = await readLegacyRule(name);
    return withDeprecation(Response.json(record));
  } catch (err) {
    if (err instanceof LegacyAdapterError) {
      return withDeprecation(Response.json({ error: err.message }, { status: err.status }));
    }
    return withDeprecation(Response.json({ error: "Failed to read rule" }, { status: 500 }));
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const { name } = await params;
  let body: { content?: unknown };
  try {
    body = (await request.json()) as { content?: unknown };
  } catch {
    return withDeprecation(Response.json({ error: "Invalid JSON body" }, { status: 400 }));
  }
  if (typeof body.content !== "string") {
    return withDeprecation(Response.json({ error: "content must be a string" }, { status: 400 }));
  }
  try {
    await updateLegacyRule(name, body.content);
  } catch (err) {
    if (err instanceof LegacyAdapterError) {
      return withDeprecation(Response.json({ error: err.message }, { status: err.status }));
    }
    return withDeprecation(Response.json({ error: "Failed to update rule" }, { status: 500 }));
  }
  return withDeprecation(Response.json({ ok: true }));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const { name } = await params;
  try {
    await deleteLegacyRule(name);
  } catch (err) {
    if (err instanceof LegacyAdapterError) {
      return withDeprecation(Response.json({ error: err.message }, { status: err.status }));
    }
    return withDeprecation(Response.json({ error: "Failed to delete rule" }, { status: 500 }));
  }
  return withDeprecation(Response.json({ ok: true }));
}
