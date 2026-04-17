import { spawn } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { loadCredentials, isMcpServerRegistered } from "@/lib/google-custom-config";

/** Check if `uvx` is installed and on PATH. */
function checkUvx(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("uvx", ["--version"], {
      stdio: ["ignore", "ignore", "ignore"],
      shell: true,
      windowsHide: true,
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

  const [uvxInstalled, creds, registered] = await Promise.all([
    checkUvx(),
    loadCredentials(),
    isMcpServerRegistered(),
  ]);

  return Response.json({
    uvxInstalled,
    credentialsConfigured: !!creds,
    // "connected" means both credentials are saved AND the MCP server is registered
    // (meaning authorize has been run at least once).
    connected: !!creds && registered,
  });
}
