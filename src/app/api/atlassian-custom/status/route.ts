import { extractSession, unauthorized } from "@/lib/auth-server";
import { isBitbucketMcpRegistered, loadCredentials } from "@/lib/atlassian-custom-config";

/**
 * Per-half status for the unified Atlassian connection. The settings
 * page renders a row per half (Jira / Bitbucket) so the UI can show
 * one connected and one disconnected at the same time.
 */
export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  const creds = await loadCredentials();
  const registered = await isBitbucketMcpRegistered();

  return Response.json({
    saved: !!creds,
    email: creds?.email ?? null,
    jira: creds?.jira
      ? {
          connected: true,
          siteUrl: creds.jira.siteUrl,
          displayName: creds.jira.displayName ?? null,
        }
      : null,
    bitbucket: creds?.bitbucket
      ? {
          connected: true,
          workspace: creds.bitbucket.workspace,
          displayName: creds.bitbucket.displayName ?? null,
          registered,
        }
      : null,
  });
}
