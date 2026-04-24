import { existsSync } from "fs";
import { chmod, mkdir, readFile, rename, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

/**
 * Account-scoped Claude subscriber rate-limit cache.
 *
 * The Claude Agent SDK emits `rate_limit_event` messages during any turn;
 * those events reflect the Anthropic account bound to the OAuth token, not
 * the per-session conversation. We merge every event into a single global
 * cache on disk at `~/.claude/claw-account-rate-limits.json` — one file for
 * the whole deployment because this wrapper is single-user (one account).
 *
 * The HUD popup reads this via a REST endpoint rather than a WebSocket
 * broadcast, so any tab can show the current 5h / 7d picture regardless of
 * which chat is active.
 */

export interface RateLimitWindow {
  status: "allowed" | "allowed_warning" | "rejected";
  /** 0..1, as emitted by the SDK. */
  utilization?: number;
  /** Unix ms, normalised from the SDK's seconds/ms hybrid. */
  resetsAt?: number | null;
  isUsingOverage?: boolean;
}

/**
 * Keyed by SDK rateLimitType: "five_hour" | "seven_day" |
 * "seven_day_opus" | "seven_day_sonnet" | "overage".
 * Unknown types are stored too — we just don't display them.
 */
export type RateLimits = Record<string, RateLimitWindow>;

export interface RateLimitsCache {
  /** Unix ms of the last write. */
  updatedAt: number | null;
  windows: RateLimits;
}

const EMPTY: RateLimitsCache = { updatedAt: null, windows: {} };

function cacheFile(): string {
  return join(homedir(), ".claude", "claw-account-rate-limits.json");
}

/** In-process cache so reads during a single turn don't hit disk repeatedly. */
let inMemory: RateLimitsCache | null = null;

/** Load the cache from disk, falling back to in-memory or empty on error. */
export async function loadRateLimits(): Promise<RateLimitsCache> {
  if (inMemory) return inMemory;
  const path = cacheFile();
  if (!existsSync(path)) {
    inMemory = { ...EMPTY };
    return inMemory;
  }
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<RateLimitsCache>;
    inMemory = {
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : null,
      windows:
        parsed.windows && typeof parsed.windows === "object" ? (parsed.windows as RateLimits) : {},
    };
    return inMemory;
  } catch {
    inMemory = { ...EMPTY };
    return inMemory;
  }
}

async function saveToDisk(cache: RateLimitsCache): Promise<void> {
  const path = cacheFile();
  await mkdir(join(path, ".."), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(cache), "utf-8");
  await rename(tmp, path);
  try {
    await chmod(path, 0o600);
  } catch {
    /* non-POSIX — best-effort */
  }
}

/**
 * Normalise an SDK-emitted timestamp to milliseconds. SDKs have emitted
 * both seconds and ms historically; values below ~1e11 (before year 5138
 * if interpreted as ms) are treated as seconds.
 */
function toMillis(t: unknown): number | null {
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return null;
  return t < 1e11 ? t * 1000 : t;
}

/**
 * Merge a single `rate_limit_event` payload into the cache and flush to
 * disk. Never throws — I/O errors are swallowed so a write failure can't
 * kill an in-flight turn. Returns the updated cache.
 *
 * MERGE semantics: fields that aren't present in the new event are
 * preserved from the existing window. Without this, a probe that only
 * carries `status` + `resetsAt` would wipe `utilization` that an
 * earlier SDK event had populated, and the HUD would drop back to a
 * status-only badge even though we do know the percentage.
 */
export async function applyRateLimitEvent(
  rateLimitInfo: Record<string, unknown>,
): Promise<RateLimitsCache> {
  const type = typeof rateLimitInfo.rateLimitType === "string" ? rateLimitInfo.rateLimitType : null;
  if (!type) return await loadRateLimits();

  const statusRaw = typeof rateLimitInfo.status === "string" ? rateLimitInfo.status : null;
  const incomingStatus: RateLimitWindow["status"] | undefined = !statusRaw
    ? undefined
    : statusRaw === "rejected"
      ? "rejected"
      : statusRaw === "allowed_warning"
        ? "allowed_warning"
        : "allowed";

  const incomingUtilization =
    typeof rateLimitInfo.utilization === "number" && Number.isFinite(rateLimitInfo.utilization)
      ? rateLimitInfo.utilization
      : undefined;
  const incomingResetsAt = toMillis(rateLimitInfo.resetsAt);
  const incomingOverage =
    typeof rateLimitInfo.isUsingOverage === "boolean" ? rateLimitInfo.isUsingOverage : undefined;

  const current = await loadRateLimits();
  const prev = current.windows[type];

  // Merge: new value wins if provided, otherwise keep the old one.
  const merged: RateLimitWindow = {
    status: incomingStatus ?? prev?.status ?? "allowed",
    ...(incomingUtilization !== undefined
      ? { utilization: incomingUtilization }
      : prev?.utilization !== undefined
        ? { utilization: prev.utilization }
        : {}),
    resetsAt: incomingResetsAt ?? prev?.resetsAt ?? null,
    ...(incomingOverage !== undefined
      ? { isUsingOverage: incomingOverage }
      : typeof prev?.isUsingOverage === "boolean"
        ? { isUsingOverage: prev.isUsingOverage }
        : {}),
  };
  const next: RateLimitsCache = {
    updatedAt: Date.now(),
    windows: { ...current.windows, [type]: merged },
  };
  inMemory = next;
  try {
    await saveToDisk(next);
  } catch {
    /* keep the in-memory update even if the write failed */
  }
  return next;
}

/** Clear the in-memory cache — test-only. */
export function __resetForTests(): void {
  inMemory = null;
}
