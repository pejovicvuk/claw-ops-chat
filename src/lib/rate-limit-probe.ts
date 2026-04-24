import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { applyRateLimitEvent } from "./account-rate-limits";

/**
 * Poll Anthropic's `/v1/messages` endpoint with a 1-token ping so we can
 * harvest the subscriber-window rate-limit headers into our account cache,
 * independent of any chat session. Fires on server boot + on a 15-minute
 * interval so the HUD popup is never stale.
 *
 * Why this exists: the Claude Agent SDK emits `rate_limit_event` messages
 * during turns, but they only carry `status` + `resetsAt` (no
 * `utilization`) and often only `five_hour` — so the HUD was stuck on "—"
 * for the 7-day row on fresh deployments. The probe can at minimum
 * populate the 5h + 7d status/reset picture within seconds of boot.
 *
 * We deliberately read the OAuth token Claude Code already manages at
 * `~/.claude/.credentials.json` (honouring `CLAUDE_CODE_OAUTH_TOKEN` env
 * override, same precedence the CLI uses). No new auth flow.
 */

/** Header name → field extraction for the `unified-*` response headers. */
const HEADER_PREFIX = "anthropic-ratelimit-unified-";

interface CredentialsFile {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    scopes?: string[];
  };
}

/** Read the OAuth access token from env var or ~/.claude/.credentials.json. */
async function readAccessToken(): Promise<string | null> {
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (typeof envToken === "string" && envToken.trim().length > 0) {
    return envToken.trim();
  }
  const path = join(homedir(), ".claude", ".credentials.json");
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as CredentialsFile;
    const tok = parsed.claudeAiOauth?.accessToken;
    return typeof tok === "string" && tok.length > 0 ? tok : null;
  } catch {
    return null;
  }
}

export interface ProbeResult {
  /** Parsed rate-limit info written to the cache. */
  applied: number;
  /** Raw HTTP status from the ping (for debugging); 0 on transport error. */
  httpStatus: number;
}

/**
 * Normalise an Anthropic header value for `anthropic-ratelimit-unified-status`
 * into one of our three canonical statuses.
 */
function parseStatus(raw: string | null): "allowed" | "allowed_warning" | "rejected" {
  if (!raw) return "allowed";
  const v = raw.toLowerCase();
  if (v === "rejected") return "rejected";
  if (v === "allowed_warning" || v === "warning") return "allowed_warning";
  return "allowed";
}

/**
 * Parse an RFC 3339 timestamp OR unix seconds/ms string into unix ms.
 * Anthropic sends the reset header as an RFC 3339 datetime for unified
 * limits; returns null if it can't be interpreted.
 */
function parseReset(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Try ISO datetime first.
  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate) && asDate > 0) return asDate;
  // Fall back to numeric: treat small values as seconds, large as ms.
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum > 0) {
    return asNum < 1e11 ? asNum * 1000 : asNum;
  }
  return null;
}

/**
 * Extract one rate-limit window from response headers. Returns null if the
 * headers don't carry the fields we need.
 *
 * IMPORTANT: Anthropic's unified headers carry ONE window's status per
 * response (typically the most restrictive currently in effect). We can't
 * distinguish five_hour vs seven_day from headers alone. The probe writes
 * under `five_hour` because that's the window that changes most often;
 * seven_day is surfaced by the SDK's `rate_limit_event` stream on actual
 * chat turns.
 */
function extractFromHeaders(headers: Headers): {
  status: "allowed" | "allowed_warning" | "rejected";
  resetsAt: number | null;
  isUsingOverage: boolean;
} | null {
  const status = headers.get(HEADER_PREFIX + "status");
  const reset = headers.get(HEADER_PREFIX + "reset");
  if (!status && !reset) return null;
  const overageStatus = headers.get(HEADER_PREFIX + "overage-status");
  return {
    status: parseStatus(status),
    resetsAt: parseReset(reset),
    isUsingOverage: overageStatus !== null && overageStatus.toLowerCase() !== "allowed",
  };
}

/**
 * Make one minimal-cost `/v1/messages` call and merge the response
 * headers into the account rate-limit cache.
 *
 * Never throws. Returns counts so the caller can log coarse health.
 */
export async function probeRateLimits(): Promise<ProbeResult> {
  const token = await readAccessToken();
  if (!token) return { applied: 0, httpStatus: 0 };

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "." }],
      }),
    });
  } catch {
    return { applied: 0, httpStatus: 0 };
  }

  const info = extractFromHeaders(response.headers);
  if (!info) return { applied: 0, httpStatus: response.status };

  // Write ONLY to the five_hour window. Anthropic's unified headers
  // carry a single window's status — typically the most restrictive
  // one currently in effect, which for most Max-plan users is the
  // 5-hour window. We can't distinguish five_hour vs seven_day from
  // headers alone, so writing to both was producing two rows with
  // identical status + reset time. The seven_day window is populated
  // by the SDK's `rate_limit_event` stream on actual chat turns (which
  // is type-tagged), and `applyRateLimitEvent`'s merge semantics
  // preserve whatever utilization the SDK reported.
  await applyRateLimitEvent({
    rateLimitType: "five_hour",
    status: info.status,
    resetsAt: info.resetsAt ?? undefined,
    isUsingOverage: info.isUsingOverage,
  });
  return { applied: 1, httpStatus: response.status };
}

/**
 * Schedule `probeRateLimits()` on boot + every `intervalMs` (default
 * 15min). Returns the timer handle so callers can clear it on process
 * exit. Noop if the token is absent or fetch fails — cache is still
 * eventually populated by SDK events on real turns.
 */
export function startRateLimitProbe(intervalMs: number = 15 * 60 * 1000): NodeJS.Timeout {
  void probeRateLimits().catch(() => {
    /* swallow — already logged via returned ProbeResult */
  });
  const timer = setInterval(() => {
    void probeRateLimits().catch(() => {
      /* swallow */
    });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}
