/**
 * Public OAuth callback for the Google Workspace MCP setup flow.
 *
 * Google redirects the browser here after the user consents. We forward
 * the `code` / `state` / `scope` params to workspace-mcp's internal HTTP
 * server (bound to 127.0.0.1:WORKSPACE_MCP_PORT inside this container)
 * via a server-side fetch. workspace-mcp completes the token exchange
 * and stores credentials on disk; we just render a friendly HTML page
 * to the user.
 *
 * This route is INTENTIONALLY not session-gated — Google hits it on the
 * user's behalf with no session cookie on the chat's domain, and the
 * `code` itself is a single-use bearer Google issued for this exact
 * redirect URI, so session auth would break the flow without adding
 * security over the OAuth state parameter.
 */

const MCP_CALLBACK_BASE = `http://127.0.0.1:${process.env.WORKSPACE_MCP_PORT || "8765"}/oauth2callback`;

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
  .ok { color: #3fb950; }
  .err { color: #f85149; }
</style>
<div class="card">${body}</div>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const search = url.search; // includes leading "?"
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
       <p>The workspace-mcp helper on <code>localhost:${process.env.WORKSPACE_MCP_PORT || "8765"}</code> didn't answer.</p>
       <p>Re-open <b>Settings → Connections → Google → Run Setup in Terminal</b> and try again.</p>
       <pre style="text-align:left;white-space:pre-wrap;font-size:11px;opacity:.7">${escapeHtml(msg)}</pre>`,
      503,
    );
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c] as string);
}
