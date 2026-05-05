import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import {
  type AtlassianCredentials,
  type BitbucketHalf,
  type JiraHalf,
  deleteCredentials,
  deleteLegacyCredentials,
  loadCredentials,
  normaliseSiteUrl,
  registerBitbucketMcp,
  saveCredentials,
  unregisterBitbucketMcp,
} from "@/lib/atlassian-custom-config";

/**
 * Save / update / clear the unified Atlassian credentials. The body may
 * include either, both, or neither of the Jira/Bitbucket halves; halves
 * present in the body are validated against the live Atlassian API
 * before persisting and replace any existing half. Halves omitted from
 * the body are *preserved* (so the user can connect Jira first, then
 * add Bitbucket later without re-pasting). To clear a half, send the
 * matching `remove*: true` flag.
 *
 * Bitbucket validation is two-stage: a /2.0/user probe (catches a
 * missing / invalid token, rejects with 401), followed by a workspace
 * permission probe (catches a token that's missing the
 * `read:repository:bitbucket` scope, rejects with 403). The second
 * probe is what makes a stale-app-password vs new-scoped-token
 * mismatch fail at save time instead of at first chat-tool use.
 */

const FETCH_TIMEOUT_MS = 10_000;

interface PostBody {
  email?: unknown;
  jira?: {
    siteUrl?: unknown;
    apiToken?: unknown;
  } | null;
  bitbucket?: {
    apiToken?: unknown;
    workspace?: unknown;
  } | null;
  removeJira?: unknown;
  removeBitbucket?: unknown;
}

interface ProbeError {
  status: number;
  message: string;
  /** Hint for the UI to surface the scope-fix CTA. */
  missingScope?: boolean;
}

function basicAuthHeader(email: string, token: string): string {
  return "Basic " + Buffer.from(`${email}:${token}`, "utf-8").toString("base64");
}

async function probeJira(
  email: string,
  half: { siteUrl: string; apiToken: string },
): Promise<{ displayName: string | null } | ProbeError> {
  const site = normaliseSiteUrl(half.siteUrl);
  if (!/^[\w.-]+\.atlassian\.net$/i.test(site)) {
    return {
      status: 400,
      message:
        "Jira site must be a *.atlassian.net host (e.g. mycompany.atlassian.net). Self-hosted Jira isn't supported.",
    };
  }
  try {
    const probe = await fetch(`https://${site}/rest/api/3/myself`, {
      headers: {
        Authorization: basicAuthHeader(email, half.apiToken),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (probe.status === 401 || probe.status === 403) {
      return {
        status: 400,
        message:
          "Jira rejected this token. Confirm the email matches your Atlassian account and that the token was created with Jira scopes (e.g. read:jira-work) at id.atlassian.com.",
      };
    }
    if (!probe.ok) {
      return { status: 400, message: `Jira returned ${probe.status}.` };
    }
    const data = (await probe.json()) as { displayName?: string };
    return { displayName: data.displayName ?? null };
  } catch (err) {
    return {
      status: 502,
      message: `Could not reach ${site}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function probeBitbucket(
  email: string,
  half: { apiToken: string; workspace: string },
): Promise<{ displayName: string | null } | ProbeError> {
  const auth = basicAuthHeader(email, half.apiToken);
  let displayName: string | null = null;

  // Stage 1 — confirm the credential pair itself.
  try {
    const probe = await fetch("https://api.bitbucket.org/2.0/user", {
      headers: { Authorization: auth, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (probe.status === 401) {
      return {
        status: 400,
        message:
          "Bitbucket rejected the email + token pair (401). Confirm the email is your Atlassian account email (not your Bitbucket username).",
      };
    }
    if (probe.status === 403) {
      return {
        status: 400,
        message:
          "Bitbucket rejected this token (403). Re-create it at id.atlassian.com → API tokens with at least these scopes: read:user:bitbucket, read:workspace:bitbucket, read:repository:bitbucket, read:pullrequest:bitbucket.",
        missingScope: true,
      };
    }
    if (!probe.ok) {
      return { status: 400, message: `Bitbucket /user returned ${probe.status}.` };
    }
    const data = (await probe.json()) as { display_name?: string; nickname?: string };
    displayName = data.display_name ?? data.nickname ?? null;
  } catch (err) {
    return {
      status: 502,
      message: `Could not reach api.bitbucket.org: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Stage 2 — confirm the token has read:repository:bitbucket scope by
  // hitting the workspace's repositories endpoint. A missing scope on
  // an otherwise-valid token surfaces here as a 403; without this
  // probe, the bad token only blows up later in a chat tool result.
  try {
    const url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(half.workspace)}?pagelen=1`;
    const probe = await fetch(url, {
      headers: { Authorization: auth, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (probe.status === 403) {
      return {
        status: 400,
        message:
          "Token authenticated but can't read the workspace's repositories (403). Add the read:repository:bitbucket and read:workspace:bitbucket scopes to the token at id.atlassian.com.",
        missingScope: true,
      };
    }
    if (probe.status === 404) {
      return {
        status: 400,
        message: `Workspace "${half.workspace}" not found. Check the slug — it's the bit after bitbucket.org/ in your URL.`,
      };
    }
    if (!probe.ok) {
      return {
        status: 400,
        message: `Bitbucket /repositories/${half.workspace} returned ${probe.status}.`,
      };
    }
  } catch (err) {
    return {
      status: 502,
      message: `Could not reach api.bitbucket.org: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { displayName };
}

async function postHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) {
    return Response.json({ error: "email is required" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Email doesn't look valid." }, { status: 400 });
  }

  const removeJira = body.removeJira === true;
  const removeBitbucket = body.removeBitbucket === true;

  const jiraInput =
    body.jira && typeof body.jira === "object"
      ? {
          siteUrl: typeof body.jira.siteUrl === "string" ? body.jira.siteUrl.trim() : "",
          apiToken: typeof body.jira.apiToken === "string" ? body.jira.apiToken.trim() : "",
        }
      : null;
  const bitbucketInput =
    body.bitbucket && typeof body.bitbucket === "object"
      ? {
          apiToken:
            typeof body.bitbucket.apiToken === "string" ? body.bitbucket.apiToken.trim() : "",
          workspace:
            typeof body.bitbucket.workspace === "string" ? body.bitbucket.workspace.trim() : "",
        }
      : null;

  const jiraProvided = !!jiraInput && !!jiraInput.siteUrl && !!jiraInput.apiToken;
  const bitbucketProvided =
    !!bitbucketInput && !!bitbucketInput.apiToken && !!bitbucketInput.workspace;

  if (!jiraProvided && !bitbucketProvided && !removeJira && !removeBitbucket) {
    return Response.json(
      { error: "Provide at least one half (jira or bitbucket) to save." },
      { status: 400 },
    );
  }

  const existing = await loadCredentials();

  let jiraHalf: JiraHalf | null = existing?.jira ?? null;
  let bitbucketHalf: BitbucketHalf | null = existing?.bitbucket ?? null;

  if (jiraProvided) {
    const result = await probeJira(email, jiraInput!);
    if ("status" in result) {
      return Response.json({ error: result.message }, { status: result.status });
    }
    jiraHalf = {
      siteUrl: normaliseSiteUrl(jiraInput!.siteUrl),
      apiToken: jiraInput!.apiToken,
      displayName: result.displayName,
    };
  }
  if (bitbucketProvided) {
    const result = await probeBitbucket(email, bitbucketInput!);
    if ("status" in result) {
      return Response.json(
        { error: result.message, missingScope: result.missingScope === true },
        { status: result.status },
      );
    }
    bitbucketHalf = {
      apiToken: bitbucketInput!.apiToken,
      workspace: bitbucketInput!.workspace,
      displayName: result.displayName,
    };
  }
  if (removeJira) jiraHalf = null;
  if (removeBitbucket) bitbucketHalf = null;

  if (!jiraHalf && !bitbucketHalf) {
    // Both halves cleared → treat as full disconnect.
    await deleteCredentials();
    await unregisterBitbucketMcp();
    return Response.json({ ok: true, cleared: true });
  }

  const next: AtlassianCredentials = {
    email,
    jira: jiraHalf,
    bitbucket: bitbucketHalf,
  };

  try {
    await saveCredentials(next);
    if (bitbucketHalf) {
      await registerBitbucketMcp(next);
    } else {
      await unregisterBitbucketMcp();
    }
    // First successful save through the unified API → drop the legacy
    // per-product files so they don't drift.
    await deleteLegacyCredentials();
  } catch (err) {
    return Response.json(
      { error: `Failed to save credentials: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    jira: jiraHalf
      ? { connected: true, siteUrl: jiraHalf.siteUrl, displayName: jiraHalf.displayName ?? null }
      : null,
    bitbucket: bitbucketHalf
      ? {
          connected: true,
          workspace: bitbucketHalf.workspace,
          displayName: bitbucketHalf.displayName ?? null,
        }
      : null,
  });
}

async function deleteHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  await deleteCredentials();
  await unregisterBitbucketMcp();
  return Response.json({ ok: true });
}

export const POST = withAudit(
  { route: "/api/atlassian-custom/credentials", label: "Atlassian credentials" },
  postHandler,
);
export const DELETE = withAudit(
  { route: "/api/atlassian-custom/credentials", label: "Atlassian credentials" },
  deleteHandler,
);
