"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveBundledClaudeBinary = resolveBundledClaudeBinary;
exports.detectClaude = detectClaude;
const fs_1 = require("fs");
const child_process_1 = require("child_process");
const path_1 = require("path");
/**
 * Resolve the absolute path to the `claude` binary bundled with the
 * claude-agent-sdk. The SDK ships per-platform optional-dep packages
 * (`claude-agent-sdk-linux-x64-musl/claude`,
 *  `claude-agent-sdk-win32-x64/claude.exe`, etc.) that npm installs
 * alongside the main package — so if the chat server can load the
 * SDK, the binary is on disk at a known relative path.
 *
 * Used by the auth-login flow to avoid relying on `claude` being on
 * the container's PATH (it often isn't — the CLI may never have been
 * installed globally; only the SDK is a direct dependency). Returns
 * null only when no platform tarball installed (unsupported arch), in
 * which case callers should fall back to `which claude`.
 *
 * On Linux we probe the **musl** variant first because the production
 * Docker image is based on `node:24-alpine`, and npm installs the
 * `-musl` tarball there — not the glibc one. Probe order on other
 * platforms is inconsequential because only one variant is installed.
 */
const PLATFORM_PACKAGES = {
  // Names mirror the SDK's optionalDependencies list verbatim; see
  // node_modules/@anthropic-ai/claude-agent-sdk/package.json.
  "linux-x64": ["claude-agent-sdk-linux-x64-musl", "claude-agent-sdk-linux-x64"],
  "linux-arm64": ["claude-agent-sdk-linux-arm64-musl", "claude-agent-sdk-linux-arm64"],
  "darwin-x64": ["claude-agent-sdk-darwin-x64"],
  "darwin-arm64": ["claude-agent-sdk-darwin-arm64"],
  "win32-x64": ["claude-agent-sdk-win32-x64"],
  "win32-arm64": ["claude-agent-sdk-win32-arm64"],
};
function resolveBundledClaudeBinary() {
  const key = `${process.platform}-${process.arch}`;
  const candidates = PLATFORM_PACKAGES[key] ?? [];
  if (candidates.length === 0) return null;
  const binName = process.platform === "win32" ? "claude.exe" : "claude";
  const roots = [
    // Flat hoist (standard npm layout).
    (0, path_1.join)(process.cwd(), "node_modules", "@anthropic-ai"),
    // Nested fallback — older npm versions occasionally tuck optional
    // platform tarballs under the parent package's own node_modules.
    (0, path_1.join)(
      process.cwd(),
      "node_modules",
      "@anthropic-ai",
      "claude-agent-sdk",
      "node_modules",
      "@anthropic-ai",
    ),
  ];
  for (const pkg of candidates) {
    for (const root of roots) {
      const candidate = (0, path_1.join)(root, pkg, binName);
      if ((0, fs_1.existsSync)(candidate)) return candidate;
    }
  }
  return null;
}
/**
 * Detect whether Claude Code CLI is installed and usable.
 * Tries system-installed `claude` first (user-managed, always up to date),
 * then falls back to the bundled SDK cli.js.
 */
/**
 * Normalize path to forward slashes.
 * Node.js spawn() on Windows mangles backslash paths (treats them as escapes).
 * Forward slashes work correctly on all platforms.
 */
function normalizePath(p) {
  return p.replace(/\\/g, "/");
}
function detectClaude() {
  // 1. Try system-installed claude (preferred)
  try {
    const cmd = process.platform === "win32" ? "where claude" : "which claude";
    const systemPath = (0, child_process_1.execSync)(cmd, { encoding: "utf-8", timeout: 5000 })
      .trim()
      .split("\n")[0];
    if (systemPath && (0, fs_1.existsSync)(systemPath)) {
      const version = getVersion(systemPath);
      if (version) {
        return { available: true, version, path: normalizePath(systemPath) };
      }
    }
  } catch {
    // not installed system-wide
  }
  // 2. Try the bundled SDK. The SDK has changed layout across versions:
  //    - v0.1.x shipped a sibling `cli.js` that could be invoked via `node cli.js --version`.
  //    - v0.2.x ships `sdk.mjs` as its sole entry and manages the Claude binary internally.
  //    If either file is present, the SDK is installed and chat will work.
  try {
    const sdkMain = require.resolve("@anthropic-ai/claude-agent-sdk");
    const sdkDir = (0, path_1.dirname)(sdkMain);
    const sdkCli = (0, path_1.join)(sdkDir, "cli.js");
    if ((0, fs_1.existsSync)(sdkCli)) {
      const version = getVersion(sdkCli);
      if (version) {
        return { available: true, version, path: normalizePath(sdkCli) };
      }
    }
    // Modern SDK (v0.2+) — no sibling cli.js; the .mjs entry is proof enough.
    if ((0, fs_1.existsSync)(sdkMain)) {
      const sdkVersion = readSdkVersion(sdkDir);
      return {
        available: true,
        version: sdkVersion ? `sdk ${sdkVersion}` : "sdk",
        path: normalizePath(sdkMain),
      };
    }
  } catch {
    // SDK not installed — or, more commonly in a Next.js route context,
    // `require.resolve` was rewritten by SWC and couldn't find the
    // package even though it's sitting in node_modules. The direct-file
    // probe below catches that case.
  }
  // 3. Direct file probe. Mirrors what `sdk-loader.js` does at server
  //    boot (server.ts:13) — it's a plain `require("./sdk-loader.js")`
  //    that then does a cwd-relative path resolve. If server.ts booted,
  //    that file loaded, which means the SDK is present on disk. Next.js's
  //    API-route bundler doesn't touch cwd-relative fs.existsSync, so this
  //    path works where require.resolve fails.
  try {
    const direct = (0, path_1.join)(
      process.cwd(),
      "node_modules",
      "@anthropic-ai",
      "claude-agent-sdk",
      "sdk.mjs",
    );
    if ((0, fs_1.existsSync)(direct)) {
      const v = readSdkVersion((0, path_1.dirname)(direct));
      return {
        available: true,
        version: v ? `sdk ${v}` : "sdk",
        path: normalizePath(direct),
      };
    }
  } catch {
    /* ignore */
  }
  return { available: false, error: "Claude Code CLI is not installed" };
}
/** Read the SDK package.json version without invoking any binary. */
function readSdkVersion(sdkDir) {
  try {
    const pkgPath = (0, path_1.join)(sdkDir, "package.json");
    if (!(0, fs_1.existsSync)(pkgPath)) return null;
    const raw = (0, fs_1.readFileSync)(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);
    return pkg.version ?? null;
  } catch {
    return null;
  }
}
/** Run the executable with --version and return the output. */
function getVersion(executablePath) {
  try {
    const normalized = normalizePath(executablePath);
    const cmd = normalized.endsWith(".js")
      ? `node "${normalized}" --version`
      : `"${normalized}" --version`;
    return (0, child_process_1.execSync)(cmd, { encoding: "utf-8", timeout: 10000 }).trim() || null;
  } catch {
    return null;
  }
}
