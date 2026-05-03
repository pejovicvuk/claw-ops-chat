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
 * during turns, but only on actual chat turns — so the HUD's percentage
 * was stuck at the last-emitted value (sometimes 95% for hours) when the
 * user wasn't actively chatting. The probe queries Anthropic on a timer
 * and updates the cache regardless of chat activity.
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
  /** Number of rate-limit windows merged into the cache. 0..3. */
  applied: number;
  /** Raw HTTP status from the ping (for debugging); 0 on transport error. */
  httpStatus: number;
}

type Status = "allowed" | "allowed_warning" | "rejected";

/** Normalise a `*-status` header value. */
function parseStatus(raw: string | null): Status {
  if (!raw) return "allowed";
  const v = raw.toLowerCase();
  if (v === "rejected") return "rejected";
  if (v === "allowed_warning" || v === "warning") return "allowed_warning";
  return "allowed";
}

/**
 * Parse a `*-reset` header into unix ms. Anthropic sends RFC 3339 for
 * unified rate-limit headers, but historic responses have used numeric
 * seconds/ms — handle all three.
 */
function parseReset(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate) && asDate > 0) return asDate;
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum > 0) {
    return asNum < 1e11 ? asNum * 1000 : asNum;
  }
  return null;
}

/** Parse a `*-utilization` header (a 0..1 float) into a number, or null. */
function parseUtilization(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

/** One window extracted from response headers, ready to apply. */
interface ExtractedWindow {
  rateLimitType: "five_hour" | "seven_day" | "overage";
  status: Status;
  resetsAt: number | null;
  /** Present iff Anthropic returned a `*-utilization` header. */
  utilization: number | null;
}

/**
 * Read one window from `<HEADER_PREFIX><scope>-{status,reset,utilization}`.
 * Returns null when none of the three headers are present.
 */
function readScopedWindow(
  headers: Headers,
  scope: "5h" | "7d" | "overage",
  type: ExtractedWindow["rateLimitType"],
): ExtractedWindow | null {
  const status = headers.get(HEADER_PREFIX + scope + "-status");
  const reset = headers.get(HEADER_PREFIX + scope + "-reset");
  const util = headers.get(HEADER_PREFIX + scope + "-utilization");
  if (!status && !reset && util === null) return null;
  return {
    rateLimitType: type,
    status: parseStatus(status),
    resetsAt: parseReset(reset),
    utilization: parseUtilization(util),
  };
}

/**
 * Extract every window we know how to read from the response headers.
 *
 * Anthropic's unified rate-limit response carries per-window headers:
 *   anthropic-ratelimit-unified-{5h,7d,overage}-{status,reset,utilization}
 *
 * "Modern mode" is detected by the presence of either `5h-*` or `7d-*`
 * — those are the windows the HUD actually displays as percentages,
 * and they're the ones the legacy bare headers can't describe. When at
 * least one is present, we trust per-window mode and read overage as
 * its own window too.
 *
 * Older responses (and some endpoints) only emit the bare unified-*
 * headers — a single status+reset with no utilization. In that path
 * the lone `overage-status` is treated as a flag (matching the
 * original behaviour) rather than a window write. We fall back to
 * writing one `five_hour` entry without utilization.
 */
function extractWindows(headers: Headers): ExtractedWindow[] {
  const fiveHour = readScopedWindow(headers, "5h", "five_hour");
  const sevenDay = readScopedWindow(headers, "7d", "seven_day");
  const overage = readScopedWindow(headers, "overage", "overage");

  if (fiveHour || sevenDay) {
    return [fiveHour, sevenDay, overage].filter((w): w is ExtractedWindow => w !== null);
  }

  // Legacy fallback: bare unified-status / unified-reset, with
  // overage-status acting as a boolean flag.
  const status = headers.get(HEADER_PREFIX + "status");
  const reset = headers.get(HEADER_PREFIX + "reset");
  if (!status && !reset) return [];
  return [
    {
      rateLimitType: "five_hour",
      status: parseStatus(status),
      resetsAt: parseReset(reset),
      utilization: null,
    },
  ];
}

/**
 * Make one minimal-cost `/v1/messages` call and merge each window from
 * the response headers into the account rate-limit cache.
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

  const windows = extractWindows(response.headers);
  if (windows.length === 0) return { applied: 0, httpStatus: response.status };

  // Decide which windows are "in overage" so we can stamp the existing
  // per-window `isUsingOverage` flag the rest of the app reads. Two paths:
  //   - Modern: dedicated overage window is non-allowed (status warning/
  //     rejected) or has reported utilization > 0.
  //   - Legacy: `overage-status` header is present and non-allowed.
  const overageWindow = windows.find((w) => w.rateLimitType === "overage");
  const legacyOverageStatus = response.headers.get(HEADER_PREFIX + "overage-status");
  const isUsingOverage = overageWindow
    ? overageWindow.status !== "allowed" || (overageWindow.utilization ?? 0) > 0
    : legacyOverageStatus !== null && legacyOverageStatus.toLowerCase() !== "allowed";

  let applied = 0;
  for (const w of windows) {
    await applyRateLimitEvent({
      rateLimitType: w.rateLimitType,
      status: w.status,
      ...(w.resetsAt !== null ? { resetsAt: w.resetsAt } : {}),
      ...(w.utilization !== null ? { utilization: w.utilization } : {}),
      // Overage entry doesn't decorate itself; main windows pick up the flag.
      ...(w.rateLimitType !== "overage" ? { isUsingOverage } : {}),
    });
    applied += 1;
  }
  return { applied, httpStatus: response.status };
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
