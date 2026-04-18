import { spawn } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { loadCredentials, isMcpServerRegistered } from "@/lib/google-custom-config";
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

  const [uvxInstalled, uvBinaryFound, creds, registered, powershell, downloader] =
    await Promise.all([
      checkUvx(),
      uvBinaryExists(),
      loadCredentials(),
      isMcpServerRegistered(),
      resolvePowerShell(),
      resolveDownloader(),
    ]);

  return Response.json({
    uvxInstalled,
    uvBinaryFound,
    credentialsConfigured: !!creds,
    // "connected" means both credentials are saved AND the MCP server is registered
    // (meaning authorize has been run at least once).
    connected: !!creds && registered,
    platform: detectPlatform(),
    powershell,
    downloader,
  });
}
