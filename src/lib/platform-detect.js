"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPlatform = detectPlatform;
exports.localBinDir = localBinDir;
exports.uvBinaryPath = uvBinaryPath;
exports.uvBinaryExists = uvBinaryExists;
exports.augmentPathWithLocalBin = augmentPathWithLocalBin;
exports.resolvePowerShell = resolvePowerShell;
exports.resolveDownloader = resolveDownloader;
exports.buildUvInstallCommand = buildUvInstallCommand;
const child_process_1 = require("child_process");
const promises_1 = require("fs/promises");
const os_1 = require("os");
const path_1 = require("path");
function detectPlatform() {
  if (process.platform === "win32") return "win32";
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "darwin";
  return "other";
}
/** `$HOME/.local/bin` or `%USERPROFILE%\.local\bin` — where the uv installer lands. */
function localBinDir() {
  return (0, path_1.join)((0, os_1.homedir)(), ".local", "bin");
}
/** Path to the uv binary at its canonical install location. */
function uvBinaryPath() {
  const name = process.platform === "win32" ? "uv.exe" : "uv";
  return (0, path_1.join)(localBinDir(), name);
}
async function uvBinaryExists() {
  try {
    await (0, promises_1.access)(uvBinaryPath());
    return true;
  } catch {
    return false;
  }
}
/**
 * Return a cloned env with `localBinDir()` prepended to PATH. Idempotent:
 * calling it twice is a no-op because the prefix check uses the OS separator.
 */
function augmentPathWithLocalBin(env = process.env) {
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
function runProbe(cmd, args) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const child = (0, child_process_1.spawn)(cmd, args, {
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
let psResolved;
let dlResolved;
/**
 * Find a usable PowerShell. Tries `powershell.exe`, `pwsh.exe`, then an
 * explicit System32 path. Only meaningful on Windows — returns null elsewhere.
 */
async function resolvePowerShell() {
  if (detectPlatform() !== "win32") return null;
  if (psResolved !== undefined) return psResolved;
  const candidates = [
    "powershell.exe",
    "pwsh.exe",
    process.env.WINDIR
      ? (0, path_1.join)(
          process.env.WINDIR,
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        )
      : null,
  ].filter((c) => !!c);
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
async function resolveDownloader() {
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
async function buildUvInstallCommand() {
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
