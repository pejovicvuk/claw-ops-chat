import { spawnSync } from "child_process";
import { existsSync } from "fs";

/**
 * Resolve the default interactive shell to spawn for the terminal endpoint.
 *
 * Priority:
 * 1. CLAUDE_TERMINAL_SHELL env var (takes the value verbatim as the shell path)
 * 2. Windows: pwsh.exe → powershell.exe → cmd.exe
 * 3. Unix: $SHELL → /bin/bash → /bin/sh
 */
export function resolveShell(): { shell: string; args: string[] } {
  const override = process.env.CLAUDE_TERMINAL_SHELL;
  if (override && override.trim()) {
    return { shell: override.trim(), args: [] };
  }

  if (process.platform === "win32") {
    // Prefer PowerShell 7+ if available.
    if (isOnPath("pwsh")) return { shell: "pwsh.exe", args: [] };
    // Fall back to legacy PowerShell, then cmd.exe.
    if (isOnPath("powershell")) return { shell: "powershell.exe", args: [] };
    return { shell: "cmd.exe", args: [] };
  }

  // Unix-like systems.
  const envShell = process.env.SHELL;
  if (envShell && existsSync(envShell)) {
    return { shell: envShell, args: [] };
  }
  if (existsSync("/bin/bash")) return { shell: "/bin/bash", args: [] };
  return { shell: "/bin/sh", args: [] };
}

/** Cheap check: is a binary on PATH? Returns true if `name --version` exits 0. */
function isOnPath(name: string): boolean {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(cmd, [name], { stdio: "ignore", shell: false, windowsHide: true });
    return result.status === 0;
  } catch {
    return false;
  }
}
