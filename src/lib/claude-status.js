"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectClaude = detectClaude;
const fs_1 = require("fs");
const child_process_1 = require("child_process");
const path_1 = require("path");
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
        const systemPath = (0, child_process_1.execSync)(cmd, { encoding: "utf-8", timeout: 5000 }).trim().split("\n")[0];
        if (systemPath && (0, fs_1.existsSync)(systemPath)) {
            const version = getVersion(systemPath);
            if (version) {
                return { available: true, version, path: normalizePath(systemPath) };
            }
        }
    }
    catch {
        // not installed system-wide
    }
    // 2. Try bundled SDK cli.js
    try {
        const sdkMain = require.resolve("@anthropic-ai/claude-agent-sdk");
        const sdkCli = (0, path_1.join)((0, path_1.dirname)(sdkMain), "cli.js");
        if ((0, fs_1.existsSync)(sdkCli)) {
            const version = getVersion(sdkCli);
            if (version) {
                return { available: true, version, path: normalizePath(sdkCli) };
            }
        }
    }
    catch {
        // SDK not installed
    }
    return { available: false, error: "Claude Code CLI is not installed" };
}
/** Run the executable with --version and return the output. */
function getVersion(executablePath) {
    try {
        const normalized = normalizePath(executablePath);
        const cmd = normalized.endsWith(".js")
            ? `node "${normalized}" --version`
            : `"${normalized}" --version`;
        return (0, child_process_1.execSync)(cmd, { encoding: "utf-8", timeout: 10000 }).trim() || null;
    }
    catch {
        return null;
    }
}
