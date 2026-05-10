import { extractSession, unauthorized } from "@/lib/auth-server";
import {
  DEPRECATION_HEADER,
  LegacyAdapterError,
  deleteLegacyInstructions,
  loadLegacyInstructions,
  saveLegacyInstructions,
} from "@/lib/agent-config-legacy-adapter";

/**
 * **Deprecated.** This route now reads from `/root/.memory/global/instructions.md`
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
  const record = await loadLegacyInstructions();
  return withDeprecation(Response.json(record));
}

export async function POST(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  let body: { prompt?: unknown };
  try {
    body = (await request.json()) as { prompt?: unknown };
  } catch {
    return withDeprecation(Response.json({ error: "Invalid JSON body" }, { status: 400 }));
  }
  if (typeof body.prompt !== "string") {
    return withDeprecation(Response.json({ error: "prompt must be a string" }, { status: 400 }));
  }
  try {
    await saveLegacyInstructions(body.prompt);
  } catch (err) {
    if (err instanceof LegacyAdapterError) {
      return withDeprecation(Response.json({ error: err.message }, { status: err.status }));
    }
    return withDeprecation(Response.json({ error: "Failed to save prompt" }, { status: 500 }));
  }
  return withDeprecation(Response.json({ ok: true }));
}

export async function DELETE(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  await deleteLegacyInstructions();
  return withDeprecation(Response.json({ ok: true }));
}
