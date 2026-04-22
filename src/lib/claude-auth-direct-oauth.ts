import { createHash } from "crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

/**
 * Direct OAuth flow against Anthropic's Claude Code auth endpoints.
 * Bypasses the CLI subprocess entirely — we build the authorize URL,
 * exchange the paste-code for tokens, fetch the user's profile, and
 * write `~/.claude/.credentials.json` ourselves in the same shape the
 * CLI writes. The SDK reads that file at runtime; it doesn't care who
 * wrote it as long as the shape matches.
 *
 * All endpoints + the client_id are string-extracted from the bundled
 * claude binary (see `node_modules/@anthropic-ai/claude-agent-sdk-*`).
 * If Anthropic rotates any of them, Path C (REPL-drive) is the
 * fallback — set CLAUDE_AUTH_USE_REPL=1 on the chat container.
 */

// ────────────────────────────────────────────────────────────────
// Anthropic endpoints / constants (verified against bundled CLI)
// ────────────────────────────────────────────────────────────────

// The CLI splits OAuth concerns across two hosts: the browser-facing
// authorize / callback pages live on platform.claude.com and
// claude.com, but the BACKEND endpoints (token exchange, profile,
// API-key creation) are on api.anthropic.com. My first draft pointed
// token + profile at platform.claude.com — same host as the
// authorize URL, looked consistent — and got a 400
// "Invalid request format" back from what must have been some other
// endpoint living at that path. Fixed per the CLI's `iI$` config
// block in the bundled binary.
export const AUTHORIZE_URL = "https://claude.com/cai/oauth/authorize";
export const TOKEN_ENDPOINT = "https://api.anthropic.com/v1/oauth/token";
export const PROFILE_ENDPOINT = "https://api.anthropic.com/api/oauth/profile";
export const CREATE_API_KEY_ENDPOINT =
  "https://api.anthropic.com/api/oauth/claude_cli/create_api_key";
export const REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";

/**
 * Hardcoded client_id used by the Claude Code CLI for its OAuth flow.
 * Verified from strings-extract of the bundled binary. If Anthropic
 * rotates this we lose the direct path; the REPL fallback still works
 * because it piggybacks on whatever the CLI has baked in.
 */
export const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

/**
 * Scopes the CLI requests. Order matters for display-only reasons
 * (Anthropic shows them in URL order on the consent screen).
 */
export const SCOPES = [
  "org:create_api_key",
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
];

// ────────────────────────────────────────────────────────────────
// PKCE + URL construction
// ────────────────────────────────────────────────────────────────

/** RFC 7636 §4.2 base64url(sha256(verifier)). */
export function deriveCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function buildAuthorizeUrl(opts: { state: string; codeChallenge: string }): string {
  const params = new URLSearchParams({
    // `code=true` is what the bundled CLI sends — it asks Anthropic
    // to show the code on the success page rather than auto-redirect
    // to a callback we'd have to host.
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(" "),
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    state: opts.state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

// ────────────────────────────────────────────────────────────────
// Token exchange + profile fetch
// ────────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

export async function exchangeCodeForTokens(opts: {
  code: string;
  codeVerifier: string;
  state: string;
}): Promise<TokenResponse> {
  // The CLI sends a *JSON* body (not the standard OAuth form
  // encoding) and includes `state` in the payload. Verified against
  // the `g06` function in the bundled binary:
  //   { grant_type, code, redirect_uri, client_id, code_verifier, state }
  //   headers: { "Content-Type": "application/json" }
  // My first draft used URLSearchParams — the endpoint returned
  // `{ type: "invalid_request_error", message: "Invalid request format" }`.
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: opts.codeVerifier,
      state: opts.state,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 500)}`);
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Token endpoint returned non-JSON: ${text.slice(0, 200)}`);
  }
  const access = typeof data.access_token === "string" ? data.access_token : "";
  const refresh = typeof data.refresh_token === "string" ? data.refresh_token : "";
  if (!access || !refresh) {
    throw new Error(
      `Token response missing tokens (access=${!!access}, refresh=${!!refresh}). Body: ${text.slice(0, 300)}`,
    );
  }
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: typeof data.expires_in === "number" ? data.expires_in : 3600,
    scope: typeof data.scope === "string" ? data.scope : undefined,
    token_type: typeof data.token_type === "string" ? data.token_type : undefined,
  };
}

/**
 * Lenient profile-response parser. The exact field names aren't
 * documented — we accept a few likely variants (`email` /
 * `emailAddress`, `organizationUuid` / `organization_uuid`, etc.) and
 * fall back to undefined where missing. The credentials file tolerates
 * missing fields except the email.
 */
export interface ProfileResult {
  email: string;
  organizationUuid?: string;
  subscriptionType?: string;
  /** Raw response, kept so callers can log it for one-time schema tuning. */
  raw: Record<string, unknown>;
}

export async function fetchProfile(accessToken: string): Promise<ProfileResult> {
  // Matches `_d(H)` in the bundled CLI — the profile fetch sends
  // `Content-Type: application/json` alongside the Bearer header.
  const res = await fetch(PROFILE_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Profile fetch failed (${res.status}): ${text.slice(0, 300)}`);
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Profile endpoint returned non-JSON: ${text.slice(0, 200)}`);
  }

  // Anthropic's live response is wrapped: top-level keys are `account`,
  // `organization`, `application`. The email lives at `account.email`,
  // the org UUID at `organization.uuid`, and the plan at
  // `organization.organization_type` or similar. `pickStr` walks the
  // known wrappers so the field-name variants keep working if the
  // server ever flattens the shape.
  const email = pickStr(
    raw,
    ["email", "emailAddress", "email_address"],
    ["account", "user", "oauthAccount", "profile"],
  );
  const orgUuid = pickStr(
    raw,
    ["uuid", "organizationUuid", "organization_uuid", "organizationId", "organization_id", "id"],
    ["organization", "org"],
  );
  const subscriptionType = pickStr(
    raw,
    [
      "subscriptionType",
      "subscription_type",
      "subscription",
      "plan",
      "organization_type",
      "organizationType",
    ],
    ["organization", "account", "application"],
  );

  if (!email) {
    throw new Error(
      `Profile response missing email. Top-level keys: ${Object.keys(raw).join(", ")}`,
    );
  }

  return { email, organizationUuid: orgUuid, subscriptionType, raw };
}

/**
 * Look up one of `keys` directly on `obj`, then inside each of the
 * `wrappers` sub-objects. Returns the first non-empty string found,
 * or undefined.
 */
function pickStr(
  obj: Record<string, unknown>,
  keys: string[],
  wrappers: string[] = [],
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
  }
  for (const w of wrappers) {
    const nested = obj[w];
    if (nested && typeof nested === "object") {
      for (const k of keys) {
        const v = (nested as Record<string, unknown>)[k];
        if (typeof v === "string" && v) return v;
      }
    }
  }
  return undefined;
}

// ────────────────────────────────────────────────────────────────
// Credentials file write
// ────────────────────────────────────────────────────────────────

export const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");

export interface ClaudeCredentialsFile {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
    subscriptionType?: string;
  };
  organizationUuid?: string;
  oauthAccount: {
    emailAddress: string;
  };
  /**
   * When Path B (long-lived API key) succeeds we additionally stash
   * the API key here. The CLI's own `setup-token` writes a similar
   * shape; we keep it alongside the OAuth block so both can coexist
   * without clobbering each other.
   */
  apiKey?: string;
}

export interface WriteCredentialsInput {
  tokens: TokenResponse;
  profile: ProfileResult;
  apiKey?: string;
}

/**
 * Atomic write: `.tmp` → `rename` so we never leave a half-written
 * JSON that the CLI / SDK would refuse to parse. chmod 0600 so a
 * refresh_token can't be read by other users on the host.
 */
export async function writeCredentialsFile(input: WriteCredentialsInput): Promise<void> {
  const { tokens, profile, apiKey } = input;
  const scopes = tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : [...SCOPES];
  const body: ClaudeCredentialsFile = {
    claudeAiOauth: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      scopes,
      ...(profile.subscriptionType ? { subscriptionType: profile.subscriptionType } : {}),
    },
    ...(profile.organizationUuid ? { organizationUuid: profile.organizationUuid } : {}),
    oauthAccount: { emailAddress: profile.email },
    ...(apiKey ? { apiKey } : {}),
  };

  await mkdir(dirname(CREDENTIALS_PATH), { recursive: true });
  const tmp = `${CREDENTIALS_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(body, null, 2), "utf-8");
  try {
    await chmod(tmp, 0o600);
  } catch {
    /* Windows dev — ignore. */
  }
  await rename(tmp, CREDENTIALS_PATH);
}

/** Used by logout. Tolerant of missing file. */
export async function deleteCredentialsFile(): Promise<void> {
  if (!existsSync(CREDENTIALS_PATH)) return;
  const { unlink } = await import("fs/promises");
  await unlink(CREDENTIALS_PATH).catch(() => {
    /* concurrent delete — fine. */
  });
}

/**
 * Merge a freshly-minted long-lived API key into an existing
 * credentials file (Path B). Preserves any existing `claudeAiOauth`
 * block so chat doesn't regress if the API key is later rejected.
 */
export async function mergeApiKeyIntoCredentialsFile(apiKey: string): Promise<void> {
  let existing: Partial<ClaudeCredentialsFile> = {};
  if (existsSync(CREDENTIALS_PATH)) {
    try {
      existing = JSON.parse(
        await readFile(CREDENTIALS_PATH, "utf-8"),
      ) as Partial<ClaudeCredentialsFile>;
    } catch {
      /* start fresh if malformed. */
    }
  }
  const merged = { ...existing, apiKey };
  await mkdir(dirname(CREDENTIALS_PATH), { recursive: true });
  const tmp = `${CREDENTIALS_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(merged, null, 2), "utf-8");
  try {
    await chmod(tmp, 0o600);
  } catch {
    /* ignore */
  }
  await rename(tmp, CREDENTIALS_PATH);
}

// ────────────────────────────────────────────────────────────────
// Long-lived API key (Path B)
// ────────────────────────────────────────────────────────────────

/**
 * Mint a persistent API key using the active OAuth access token
 * (`org:create_api_key` scope). Endpoint path is verified from the
 * bundled CLI's `API_KEY_URL` config constant:
 *   https://api.anthropic.com/api/oauth/claude_cli/create_api_key
 *
 * Returns null on any failure; the caller degrades gracefully to the
 * short-lived OAuth tokens already in the credentials file.
 */
export async function createLongLivedApiKey(opts: { accessToken: string }): Promise<string | null> {
  const res = await fetch(CREATE_API_KEY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as Record<string, unknown>;
    const key = pickStr(data, ["apiKey", "api_key", "key", "raw_key", "rawKey", "primary_key"]);
    return key ?? null;
  } catch {
    return null;
  }
}
