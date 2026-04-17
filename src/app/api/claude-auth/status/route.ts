import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { extractSession, unauthorized } from "@/lib/auth-server";

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
    subscriptionType?: string;
  };
  organizationUuid?: string;
  oauthAccount?: {
    emailAddress?: string;
  };
}

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const credentialsPath = join(homedir(), ".claude", ".credentials.json");

  try {
    const raw = await readFile(credentialsPath, "utf-8");
    const creds = JSON.parse(raw) as ClaudeCredentials;
    const oauth = creds.claudeAiOauth;

    if (!oauth?.accessToken) {
      return Response.json({
        connected: false,
        email: null,
        subscriptionType: null,
        expiresAt: null,
      });
    }

    return Response.json({
      connected: true,
      email: creds.oauthAccount?.emailAddress ?? null,
      subscriptionType: oauth.subscriptionType ?? null,
      expiresAt: oauth.expiresAt ?? null,
    });
  } catch {
    return Response.json({
      connected: false,
      email: null,
      subscriptionType: null,
      expiresAt: null,
    });
  }
}
