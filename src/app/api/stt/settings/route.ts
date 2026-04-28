import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import {
  deleteSettings,
  loadSettings,
  saveSettings,
  toPublic,
  type SttSettings,
} from "@/lib/stt-custom-config";
import { isKnownLanguage, isSttProvider, isSummaryProvider } from "@/lib/stt-defaults";
import { probeAnthropicKey, probeGroqKey, probeOpenAIKey } from "@/lib/stt-providers";

/**
 * GET → masked settings (booleans for key presence; never the raw keys).
 * POST → partial update; new keys are validated by an upstream probe.
 * DELETE → wipes the settings file.
 *
 * Browser never receives the API keys themselves — only `hasOpenaiKey`
 * etc. This is the deliberate deviation from `stt-dictaphone`, which
 * keeps keys in `localStorage`.
 */

async function getHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const current = await loadSettings();
  return Response.json(toPublic(current));
}

async function postHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const current = await loadSettings();
  const next: SttSettings = { ...current };

  if (typeof body.enabled === "boolean") next.enabled = body.enabled;

  if (body.sttProvider !== undefined) {
    if (!isSttProvider(body.sttProvider)) {
      return Response.json({ error: "Invalid sttProvider." }, { status: 400 });
    }
    next.sttProvider = body.sttProvider;
  }

  if (body.summaryProvider !== undefined) {
    if (!isSummaryProvider(body.summaryProvider)) {
      return Response.json({ error: "Invalid summaryProvider." }, { status: 400 });
    }
    next.summaryProvider = body.summaryProvider;
  }

  if (body.inputLanguage !== undefined) {
    if (!isKnownLanguage(body.inputLanguage)) {
      return Response.json({ error: "Unknown inputLanguage." }, { status: 400 });
    }
    next.inputLanguage = body.inputLanguage as string;
  }

  if (typeof body.translateToEnglish === "boolean") {
    next.translateToEnglish = body.translateToEnglish;
  }
  if (typeof body.summaryEnabled === "boolean") {
    next.summaryEnabled = body.summaryEnabled;
  }

  if (typeof body.summaryPrompt === "string") {
    const trimmed = body.summaryPrompt.trim();
    if (trimmed.length === 0) {
      return Response.json({ error: "summaryPrompt cannot be empty." }, { status: 400 });
    }
    next.summaryPrompt = trimmed;
  }

  // Keys: empty string clears, non-empty saves. `undefined` leaves
  // whatever was already there alone (so the UI doesn't have to send
  // every key on every save).
  for (const [field, probe] of [
    ["openaiApiKey", probeOpenAIKey],
    ["groqApiKey", probeGroqKey],
    ["anthropicApiKey", probeAnthropicKey],
  ] as const) {
    const raw = body[field];
    if (raw === undefined) continue;
    if (typeof raw !== "string") {
      return Response.json({ error: `${field} must be a string.` }, { status: 400 });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      next[field] = undefined;
      continue;
    }
    // Only probe if the value actually changed — saving the same key a
    // second time shouldn't bill the upstream provider.
    if (trimmed !== current[field]) {
      const result = await probe(trimmed);
      if (!result.ok) {
        return Response.json({ error: result.reason }, { status: 400 });
      }
    }
    next[field] = trimmed;
  }

  await saveSettings(next);
  return Response.json(toPublic(next));
}

async function deleteHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  await deleteSettings();
  return Response.json({ ok: true });
}

export const GET = withAudit({ route: "/api/stt/settings", label: "STT settings" }, getHandler);
export const POST = withAudit({ route: "/api/stt/settings", label: "STT settings" }, postHandler);
export const DELETE = withAudit(
  { route: "/api/stt/settings", label: "STT settings" },
  deleteHandler,
);
