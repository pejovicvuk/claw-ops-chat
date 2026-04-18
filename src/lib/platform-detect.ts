import { spawn } from "child_process";
import { access } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

/**
 * OS + tool detection shared by install and status routes.
 *
 * Results are cached for the lifetime of the Node process — a change in
 * installed tooling generally requires a server restart to take effect
 * anyway (the running server's PATH is frozen at startup), so caching
 * here does not introduce any new staleness.
 */

export type Platform = "win32" | "linux" | "darwin" | "other";

export function detectPlatform(): Platform {
  if (process.platform === "win32") return "win32";
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "darwin";
  return "other";
}

/** `$HOME/.local/bin` or `%USERPROFILE%\.local\bin` — where the uv installer lands. */
export function localBinDir(): string {
  return join(homedir(), ".local", "bin");
}

/** Path to the uv binary at its canonical install location. */
export function uvBinaryPath(): string {
  const name = process.platform === "win32" ? "uv.exe" : "uv";
  return join(localBinDir(), name);
}

export async function uvBinaryExists(): Promise<boolean> {
  try {
    await access(uvBinaryPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Return a cloned env with `localBinDir()` prepended to PATH. Idempotent:
 * calling it twice is a no-op because the prefix check uses the OS separator.
 */
export function augmentPathWithLocalBin(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const sep = process.platform === "win32" ? ";" : ":";
  const dir = localBinDir();
  const pathKey =
    process.platform === "win32"
      ? (Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH")
      : "PATH";
  const current = env[pathKey] ?? "";

  // Already prefixed? Skip.
  const segments = current.split(sep);
  if (segments[0] === dir) {
    return { ...env };
  }

  const next = current ? `${dir}${sep}${current}` : dir;
  return { ...env, [pathKey]: next };
}

// ───────── Tool probing ─────────

function runProbe(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const child = spawn(cmd, args, {
        stdio: ["ignore", "ignore", "ignore"],
        shell: false,
        windowsHide: true,
      });
      child.on("close", (code) => done(code === 0));
      child.on("error", () => done(false));
      setTimeout(() => {
        if (!child.killed) child.kill();
        done(false);
      }, 3000);
    } catch {
      done(false);
    }
  });
}

// Cached results.
let psResolved: string | null | undefined;
let dlResolved: "curl" | "wget" | null | undefined;

/**
 * Find a usable PowerShell. Tries `powershell.exe`, `pwsh.exe`, then an
 * explicit System32 path. Only meaningful on Windows — returns null elsewhere.
 */
export async function resolvePowerShell(): Promise<string | null> {
  if (detectPlatform() !== "win32") return null;
  if (psResolved !== undefined) return psResolved;

  const candidates = [
    "powershell.exe",
    "pwsh.exe",
    process.env.WINDIR
      ? join(process.env.WINDIR, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : null,
  ].filter((c): c is string => !!c);

  for (const exe of candidates) {
    if (await runProbe(exe, ["-NoProfile", "-Command", "exit 0"])) {
      psResolved = exe;
      return exe;
    }
  }
  psResolved = null;
  return null;
}

/**
 * Find a usable downloader for curl-style shell installers. `curl` preferred,
 * `wget` fallback. Null on Windows.
 */
export async function resolveDownloader(): Promise<"curl" | "wget" | null> {
  if (detectPlatform() === "win32") return null;
  if (dlResolved !== undefined) return dlResolved;

  if (await runProbe("curl", ["--version"])) {
    dlResolved = "curl";
    return "curl";
  }
  if (await runProbe("wget", ["--version"])) {
    dlResolved = "wget";
    return "wget";
  }
  dlResolved = null;
  return null;
}

// ───────── Install command assembly ─────────

export interface UvInstallCommand {
  /** The executable to spawn (no shell wrapper). */
  shell: string;
  /** Argv for the executable. */
  args: string[];
  /** Human-readable form for display only. */
  human: string;
}

export interface UvInstallError {
  error: string;
}

export async function buildUvInstallCommand(): Promise<UvInstallCommand | UvInstallError> {
  const platform = detectPlatform();

  if (platform === "win32") {
    const ps = await resolvePowerShell();
    if (!ps) {
      return {
        error:
          "No PowerShell found on this server. Install PowerShell 7 (pwsh) or run the install command manually.",
      };
    }
    const psCmd = "irm https://astral.sh/uv/install.ps1 | iex";
    return {
      shell: ps,
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCmd],
      human: `${ps} -NoProfile -ExecutionPolicy Bypass -Command "${psCmd}"`,
    };
  }

  if (platform === "linux" || platform === "darwin") {
    const dl = await resolveDownloader();
    if (!dl) {
      return {
        error: "Neither curl nor wget is installed. Install one of them and try again.",
      };
    }
    const shellCmd =
      dl === "curl"
        ? "curl -LsSf https://astral.sh/uv/install.sh | sh"
        : "wget -qO- https://astral.sh/uv/install.sh | sh";
    return {
      shell: "sh",
      args: ["-c", shellCmd],
      human: shellCmd,
    };
  }

  return { error: `Unsupported platform: ${process.platform}` };
}
