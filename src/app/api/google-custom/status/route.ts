import { spawn } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";
import {
  loadCredentials,
  isMcpServerRegistered,
  migrateGoogleMcpTier,
} from "@/lib/google-custom-config";
import { hasWorkspaceMcpCredentials } from "@/lib/google-workspace-mcp-tokens";
import {
  augmentPathWithLocalBin,
  detectPlatform,
  resolveDownloader,
  resolvePowerShell,
  uvBinaryExists,
} from "@/lib/platform-detect";

/**
 * Check if `uvx` is on PATH. We augment the child process's PATH with
 * `~/.local/bin` so a fresh install on this server is picked up without
 * needing to restart the running Node server.
 */
function checkUvx(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("uvx", ["--version"], {
      stdio: ["ignore", "ignore", "ignore"],
      shell: true,
      windowsHide: true,
      env: augmentPathWithLocalBin(),
    });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
    setTimeout(() => {
      if (!child.killed) child.kill();
      resolve(false);
    }, 5000);
  });
}

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();

  // Defense-in-depth: rewrite legacy `--tool-tier` values in ~/.claude.json
  // for users who connected before the tier upgrade. Idempotent and silent;
  // the boot-time migrator in server.ts is the load-bearing trigger, this
  // covers users who hit Settings → Google without restarting the server.
  await migrateGoogleMcpTier().catch(() => null);

  const [uvxInstalled, uvBinaryFound, creds, registered, powershell, downloader, hasTokens] =
    await Promise.all([
      checkUvx(),
      uvBinaryExists(),
      loadCredentials(),
      isMcpServerRegistered(),
      resolvePowerShell(),
      resolveDownloader(),
      hasWorkspaceMcpCredentials(),
    ]);

  return Response.json({
    uvxInstalled,
    uvBinaryFound,
    credentialsConfigured: !!creds,
    /**
     * `connected` here means: creds saved + MCP registered + a workspace-mcp
     * credential file exists on disk. The old check was just creds+registered,
     * but with the device-flow path a successful sign-in also writes the
     * credential file — surfacing its presence lets the UI distinguish
     * "credentials saved but never signed in" from "fully connected".
     */
    connected: !!creds && registered && hasTokens,
    /**
     * "installed" (Desktop) → device flow; "web" → redirect flow. The UI
     * picks which path to render based on this.
     */
    clientType: creds?.clientType ?? null,
    /** Email of the Google account currently signed in (null if none yet). */
    accountEmail: creds?.accountEmail ?? null,
    platform: detectPlatform(),
    powershell,
    downloader,
  });
}
