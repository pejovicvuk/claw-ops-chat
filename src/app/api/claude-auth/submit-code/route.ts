import { extractSession, unauthorized } from "@/lib/auth-server";
import { broadcastToSession, getLoginSession, clearLoginSession } from "@/lib/claude-auth-sessions";
import { consumeAuthState } from "@/lib/claude-auth-state";
import {
  createLongLivedApiKey,
  exchangeCodeForTokens,
  fetchProfile,
  mergeApiKeyIntoCredentialsFile,
  writeCredentialsFile,
} from "@/lib/claude-auth-direct-oauth";

/**
 * Receives the paste-code from the browser and completes the sign-in.
 *
 * Two modes depending on which path `/login` started:
 *
 *   - **Direct OAuth (default)**: look up the PKCE state saved at
 *     `/login` time, POST to Anthropic's token endpoint, fetch the
 *     user's profile, write `~/.claude/.credentials.json`, broadcast
 *     `done{success:true}` over the `/login` SSE stream. If method
 *     was "token", also attempt to mint a long-lived API key using
 *     the `org:create_api_key` scope and merge it into the file.
 *
 *   - **Legacy subprocess** (behind `CLAUDE_AUTH_USE_SUBCOMMAND=1`):
 *     write the code to the child's stdin, let the CLI complete the
 *     flow; the `/login` SSE stream emits `done` when the child
 *     exits. Same status-code surface as before (410 / 502) so the
 *     client's "verifying" timeout logic still makes sense.
 *
 * Status codes intentionally match so the existing UI logic
 * (settings-claude-page.tsx) stays compatible without changes:
 *
 *   200 { ok: true }  → proceeding; `done` follows on SSE
 *   400 { error }     → bad body or no code
 *   404 { error }     → no active sign-in session (user hit Submit
 *                       before clicking Sign in, or state timed out)
 *   410 { error }     → "gone" — start over (legacy path: child exited;
 *                       direct path: not used but kept for parity)
 *   502 { error }     → Anthropic rejected the code / token exchange
 *                       failed / profile fetch failed
 */
export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const { email } = session;

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    return Response.json({ error: "Code is required" }, { status: 400 });
  }

  const useSubcommand = process.env.CLAUDE_AUTH_USE_SUBCOMMAND === "1";
  if (useSubcommand) {
    return legacyStdinRelay(email, code);
  }
  return directOAuthFinish(email, code);
}

// ────────────────────────────────────────────────────────────────
// Path A — direct OAuth finish
// ────────────────────────────────────────────────────────────────

async function directOAuthFinish(email: string, code: string): Promise<Response> {
  const state = consumeAuthState(email);
  if (!state) {
    return Response.json(
      { error: "No active sign-in session. Click Sign in again to get a fresh link." },
      { status: 404 },
    );
  }

  // Respond to the browser before doing the upstream work so the
  // client's "Verifying…" spinner flips on immediately. The terminal
  // success / failure is pushed down the `/login` SSE stream.
  broadcastToSession(email, "log", {
    line: "Exchanging code with Anthropic…",
  });

  // Fire-and-forget the upstream dance. Any failure broadcasts a
  // `done{success:false}` over SSE — the UI surfaces that, and our
  // 25 s client-side safety timeout won't fire.
  void finishInBackground(email, code, state.codeVerifier, state.state, state.method).catch(
    (err) => {
      broadcastToSession(email, "done", {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    },
  );

  return Response.json({ ok: true });
}

async function finishInBackground(
  email: string,
  code: string,
  codeVerifier: string,
  state: string,
  method: string,
): Promise<void> {
  // 1. Token exchange.
  let tokens;
  try {
    tokens = await exchangeCodeForTokens({ code, codeVerifier, state });
  } catch (err) {
    broadcastToSession(email, "done", {
      success: false,
      error: `Anthropic rejected the code: ${err instanceof Error ? err.message : "unknown error"}`,
    });
    return;
  }
  broadcastToSession(email, "log", { line: "Tokens received — fetching profile…" });

  // 2. Profile fetch (email, org uuid, subscription type).
  let profile;
  try {
    profile = await fetchProfile(tokens.access_token);
  } catch (err) {
    broadcastToSession(email, "done", {
      success: false,
      error: `Couldn't read your Claude profile: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    });
    return;
  }
  broadcastToSession(email, "log", { line: `Signed in as ${profile.email}` });

  // 3. Optional long-lived API key (Path B). Only attempted when the
  //    user picked the "Long-lived token" method in the wizard. If it
  //    fails (endpoint 404, wrong scope, missing org), we degrade
  //    silently to plain OAuth tokens — the chat still works,
  //    auto-refreshing on expiry.
  let apiKey: string | undefined;
  if (method === "token") {
    const key = await createLongLivedApiKey({ accessToken: tokens.access_token });
    if (key) {
      apiKey = key;
      broadcastToSession(email, "log", { line: "Long-lived API key minted." });
    } else {
      broadcastToSession(email, "log", {
        line: "Long-lived key endpoint unavailable — using rotating OAuth token instead.",
      });
    }
  }

  // 4. Persist.
  try {
    await writeCredentialsFile({ tokens, profile, apiKey });
  } catch (err) {
    broadcastToSession(email, "done", {
      success: false,
      error: `Couldn't save credentials: ${err instanceof Error ? err.message : "unknown error"}`,
    });
    return;
  }

  // 5. If we already had a creds file from a previous run that contained
  //    a long-lived key, make sure we don't blow it away when we later
  //    refresh via OAuth. `writeCredentialsFile` replaces the whole
  //    file; we re-merge here only when we actually minted a new key.
  if (apiKey) {
    try {
      await mergeApiKeyIntoCredentialsFile(apiKey);
    } catch {
      /* non-fatal; the writeCredentialsFile above already stored it */
    }
  }

  broadcastToSession(email, "done", { success: true, email: profile.email });
  // Clear the (noop) login session so status=idle from the server's
  // perspective and the sidebar / UI reflect completion.
  clearLoginSession(email);
}

// ────────────────────────────────────────────────────────────────
// Path D — legacy stdin relay (kept for CLAUDE_AUTH_USE_SUBCOMMAND=1)
// ────────────────────────────────────────────────────────────────

function legacyStdinRelay(email: string, code: string): Response {
  const loginSession = getLoginSession(email);
  if (!loginSession) {
    return Response.json(
      { error: "No active login session. Start the login flow first." },
      { status: 404 },
    );
  }
  const subprocess = loginSession.process;
  if (subprocess.exitCode !== null || subprocess.killed) {
    return Response.json(
      { error: "Login process already ended — start the sign-in flow again." },
      { status: 410 },
    );
  }
  try {
    subprocess.write(`${code}\n`);
  } catch (err) {
    return Response.json(
      {
        error: `Couldn't reach the Claude CLI: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      },
      { status: 502 },
    );
  }
  broadcastToSession(email, "log", { line: "Submitted code, waiting for Claude…" });
  return Response.json({ ok: true });
}
