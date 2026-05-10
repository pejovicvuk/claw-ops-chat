import { extractSession, unauthorized } from "@/lib/auth-server";
import {
  DEPRECATION_HEADER,
  LegacyAdapterError,
  createLegacyRule,
  listLegacyRules,
} from "@/lib/agent-config-legacy-adapter";

/**
 * **Deprecated.** Reads/writes from `/root/.memory/global/rules/<name>.md`
 * via the legacy adapter. New callers should use `/api/memory/global` instead.
 * Slated for removal alongside `getCustomAppendForSdk()` in a follow-up PR.
 */

function withDeprecation(res: Response): Response {
  for (const [k, v] of Object.entries(DEPRECATION_HEADER)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const items = await listLegacyRules();
  return withDeprecation(Response.json({ items }));
}

export async function POST(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  let body: { name?: unknown; content?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; content?: unknown };
  } catch {
    return withDeprecation(Response.json({ error: "Invalid JSON body" }, { status: 400 }));
  }
  if (typeof body.name !== "string" || typeof body.content !== "string") {
    return withDeprecation(
      Response.json({ error: "name and content are required" }, { status: 400 }),
    );
  }
  try {
    await createLegacyRule(body.name, body.content);
  } catch (err) {
    if (err instanceof LegacyAdapterError) {
      return withDeprecation(Response.json({ error: err.message }, { status: err.status }));
    }
    return withDeprecation(Response.json({ error: "Failed to create rule" }, { status: 500 }));
  }
  return withDeprecation(Response.json({ ok: true }));
}
