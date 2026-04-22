import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";

export interface ClaudeInfo {
  available: boolean;
  version?: string;
  path?: string;
  error?: string;
}

/**
 * Resolve the absolute path to the `claude` binary bundled with the
 * claude-agent-sdk. The SDK ships per-platform optional dep packages
 * (`claude-agent-sdk-linux-x64/claude`, `claude-agent-sdk-win32-x64/claude.exe`,
 * etc.) that npm installs alongside the main package — so if the chat
 * server can load the SDK, the binary is on disk at a known relative path.
 *
 * Used by the auth-login flow to avoid relying on `claude` being on the
 * container's PATH (it often isn't — the CLI may never have been
 * installed globally; only the SDK is a direct dependency). Returns
 * null only when the platform tarball didn't install (unsupported
 * arch), in which case callers should fall back to `which claude`.
 */
export function resolveBundledClaudeBinary(): string | null {
  const pkgName = `claude-agent-sdk-${process.platform}-${process.arch}`;
  const binName = process.platform === "win32" ? "claude.exe" : "claude";
  const candidate = join(process.cwd(), "node_modules", "@anthropic-ai", pkgName, binName);
  if (existsSync(candidate)) return candidate;
  // Very unlikely secondary location — older npm layouts put optional
  // platform packages inside the main package's node_modules.
  const nested = join(
    process.cwd(),
    "node_modules",
    "@anthropic-ai",
    "claude-agent-sdk",
    "node_modules",
    "@anthropic-ai",
    pkgName,
    binName,
  );
  if (existsSync(nested)) return nested;
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
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

export function detectClaude(): ClaudeInfo {
  // 1. Try system-installed claude (preferred)
  try {
    const cmd = process.platform === "win32" ? "where claude" : "which claude";
    const systemPath = execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim().split("\n")[0];
    if (systemPath && existsSync(systemPath)) {
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
    const sdkDir = dirname(sdkMain);
    const sdkCli = join(sdkDir, "cli.js");
    if (existsSync(sdkCli)) {
      const version = getVersion(sdkCli);
      if (version) {
        return { available: true, version, path: normalizePath(sdkCli) };
      }
    }
    // Modern SDK (v0.2+) — no sibling cli.js; the .mjs entry is proof enough.
    if (existsSync(sdkMain)) {
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
    const direct = join(
      process.cwd(),
      "node_modules",
      "@anthropic-ai",
      "claude-agent-sdk",
      "sdk.mjs",
    );
    if (existsSync(direct)) {
      const v = readSdkVersion(dirname(direct));
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
function readSdkVersion(sdkDir: string): string | null {
  try {
    const pkgPath = join(sdkDir, "package.json");
    if (!existsSync(pkgPath)) return null;
    const raw = readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

/** Run the executable with --version and return the output. */
function getVersion(executablePath: string): string | null {
  try {
    const normalized = normalizePath(executablePath);
    const cmd = normalized.endsWith(".js")
      ? `node "${normalized}" --version`
      : `"${normalized}" --version`;
    return execSync(cmd, { encoding: "utf-8", timeout: 10000 }).trim() || null;
  } catch {
    return null;
  }
}
