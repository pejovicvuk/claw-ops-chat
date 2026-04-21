import { loadCredentials, registerMcpServer, saveCredentials } from "@/lib/google-custom-config";
import { GOOGLE_DEVICE_FLOW_SCOPES } from "@/lib/google-custom-scopes";
import { consumeOauthState } from "@/lib/google-custom-oauth-state";
import { writeWorkspaceMcpCredentials } from "@/lib/google-workspace-mcp-tokens";

/**
 * Public OAuth callback for the Google Workspace MCP setup flow.
 *
 * Two supported paths depending on the `state` param:
 *
 *   1. Server-side web-redirect flow (preferred).
 *      We minted a known `state` via /web-authorize-start. When it
 *      comes back here, we exchange `code` for tokens, write them to
 *      workspace-mcp's credential dir, register the MCP entry, and
 *      render a success page. workspace-mcp starts next time with
 *      valid tokens already on disk — no localhost:8765 round-trip
 *      needed.
 *
 *   2. Legacy workspace-mcp proxy flow (fallback).
 *      If the state isn't one of ours, we assume workspace-mcp kicked
 *      off its own OAuth (via the terminal setup path) and proxy the
 *      callback to its internal HTTP server at localhost:8765/
 *      oauth2callback so it can complete the handshake. Kept for
 *      backwards compatibility with existing deployments.
 *
 * Route is INTENTIONALLY not session-gated — Google hits it on the
 * user's behalf with no session cookie on the chat's domain, and the
 * `code` itself is a single-use bearer Google issued for this exact
 * redirect URI, so session auth would break the flow without adding
 * security over the `state` parameter.
 */

const MCP_CALLBACK_BASE = `http://127.0.0.1:${process.env.WORKSPACE_MCP_PORT || "8765"}/oauth2callback`;
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const CALLBACK_PATH = "/chat/api/google-custom/oauth-callback";

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

function resolvePublicBase(request: Request): string {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto =
    request.headers.get("x-forwarded-proto") ||
    (host && !host.startsWith("localhost") ? "https" : "http");
  if (host) return `${proto}://${host}`;
  return (process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:3100").replace(/\/+$/, "");
}

function htmlPage(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
         background: #0d1117; color: #c9d1d9;
         display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; padding: 16px; }
  .card { max-width: 440px; text-align: center;
          background: #161b22; border: 1px solid #30363d; border-radius: 10px;
          padding: 32px 28px; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  p { font-size: 13px; line-height: 1.5; color: #8b949e; margin: 0 0 8px; }
  code { background: #0d1117; padding: 2px 6px; border-radius: 4px;
         font-size: 11px; color: #c9d1d9; }
  .ok { color: #3fb950; }
  .err { color: #f85149; }
</style>
<div class="card">${body}</div>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    return (
      {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c] || c
    );
  });
}

/**
 * Exchange `code` → tokens → workspace-mcp credential file. All the
 * heavy lifting for path 1.
 */
async function finalizeServerSideFlow(request: Request, code: string): Promise<Response> {
  const creds = await loadCredentials();
  if (!creds) {
    return htmlPage(
      "Google connect failed",
      `<h1 class="err">Connect failed</h1>
       <p>The saved Google client credentials are gone. Re-upload
          <code>credentials.json</code> in Settings and try again.</p>`,
      400,
    );
  }

  const redirectUri = `${resolvePublicBase(request)}${CALLBACK_PATH}`;

  // 1. Exchange the code.
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  }).catch((err: unknown) => {
    throw new Error(
      `Could not reach Google's token endpoint: ${
        err instanceof Error ? err.message : "network error"
      }`,
    );
  });

  const tokenData = (await tokenRes.json().catch(() => ({}))) as TokenResponse;
  if (!tokenRes.ok || !tokenData.access_token || !tokenData.refresh_token) {
    return htmlPage(
      "Google connect failed",
      `<h1 class="err">Connect failed</h1>
       <p>Google rejected the code exchange.</p>
       <p>${escapeHtml(
         tokenData.error_description ||
           tokenData.error ||
           `HTTP ${tokenRes.status}${tokenData.refresh_token ? "" : " (no refresh_token — revoke app access in your Google Account and try again)"}`,
       )}</p>`,
      502,
    );
  }

  // 2. Who is this? workspace-mcp keys its credential file by email.
  const userInfoRes = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const userInfo = (await userInfoRes.json().catch(() => ({}))) as { email?: string };
  const email = typeof userInfo.email === "string" ? userInfo.email : "";
  if (!email) {
    return htmlPage(
      "Google connect failed",
      `<h1 class="err">Connect failed</h1>
       <p>Got tokens from Google but couldn't read the user's email
          (HTTP ${userInfoRes.status}).</p>`,
      502,
    );
  }

  // 3. Persist for workspace-mcp.
  try {
    await writeWorkspaceMcpCredentials({
      email,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      tokens: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresInSec: tokenData.expires_in ?? 3600,
        // Google's `scope` response may omit implied scopes; fall back
        // to what we asked for so workspace-mcp's scope check passes.
        scopes: tokenData.scope
          ? tokenData.scope.split(/\s+/).filter(Boolean)
          : GOOGLE_DEVICE_FLOW_SCOPES,
      },
    });
  } catch (err) {
    return htmlPage(
      "Google connect failed",
      `<h1 class="err">Connect failed</h1>
       <p>Could not write workspace-mcp's credential file:
          ${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`,
      500,
    );
  }

  // 4. Remember the email + register the MCP entry so Claude picks it up.
  const next = { ...creds, accountEmail: email };
  await saveCredentials(next);
  await registerMcpServer(next);

  return htmlPage(
    "Google connected",
    `<h1 class="ok">✓ Signed in as ${escapeHtml(email)}</h1>
     <p>Credentials stored on the server. Claude will use this account
        for Gmail, Drive, Calendar, Docs, and Sheets.</p>
     <p>You can close this tab — the settings panel will update
        automatically.</p>`,
  );
}

/**
 * Fallback for legacy deployments: forward to workspace-mcp's own
 * callback server on localhost:8765.
 */
async function proxyToLegacyWorkspaceMcp(search: string): Promise<Response> {
  const target = `${MCP_CALLBACK_BASE}${search}`;
  try {
    const upstream = await fetch(target, { method: "GET", redirect: "manual" });
    if (upstream.ok || (upstream.status >= 300 && upstream.status < 400)) {
      return htmlPage(
        "Google connected",
        `<h1 class="ok">✓ Google connected</h1>
         <p>Credentials stored on the server.</p>
         <p>You can close this tab — switch back to the setup terminal to confirm.</p>`,
      );
    }
    const body = await upstream.text().catch(() => "");
    return htmlPage(
      "Google connect failed",
      `<h1 class="err">Connect failed</h1>
       <p>workspace-mcp rejected the callback (HTTP ${upstream.status}).</p>
       <p>Open the setup terminal again and retry.</p>
       <pre style="text-align:left;white-space:pre-wrap;font-size:11px;opacity:.7">${escapeHtml(body).slice(0, 500)}</pre>`,
      502,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return htmlPage(
      "Setup terminal not running",
      `<h1 class="err">Setup terminal isn't running</h1>
       <p>Google redirected you here, but the server doesn't know what to do
          with this callback — it's neither a known server-side flow state
          nor can it reach workspace-mcp on
          <code>localhost:${process.env.WORKSPACE_MCP_PORT || "8765"}</code>.</p>
       <p>Open <b>Settings → Connections → Google</b> and use the
          <b>Sign in with Google</b> button (server-side flow). The old
          "Run Setup in Terminal" path isn't needed anymore.</p>
       <pre style="text-align:left;white-space:pre-wrap;font-size:11px;opacity:.7">${escapeHtml(msg)}</pre>`,
      503,
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // User explicitly denied consent.
  if (error) {
    return htmlPage(
      "Google sign-in cancelled",
      `<h1 class="err">Sign-in cancelled</h1>
       <p>${escapeHtml(url.searchParams.get("error_description") || error)}</p>
       <p>Close this tab and click <b>Sign in with Google</b> again to retry.</p>`,
      400,
    );
  }

  // Path 1 — server-side flow: state was minted by /web-authorize-start.
  if (code && consumeOauthState(state)) {
    try {
      return await finalizeServerSideFlow(request, code);
    } catch (err) {
      return htmlPage(
        "Google connect failed",
        `<h1 class="err">Connect failed</h1>
         <p>${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`,
        500,
      );
    }
  }

  // Path 2 — legacy proxy to workspace-mcp.
  return proxyToLegacyWorkspaceMcp(url.search);
}
