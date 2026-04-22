"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normaliseDomain = normaliseDomain;
exports.saveCredentials = saveCredentials;
exports.loadCredentials = loadCredentials;
exports.loadCredentialsSync = loadCredentialsSync;
exports.deleteCredentials = deleteCredentials;
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const os_1 = require("os");
/**
 * Stores Jira Cloud credentials. Mirrors the Bitbucket pattern: no MCP
 * server is registered; instead server.ts injects JIRA_URL / JIRA_EMAIL /
 * JIRA_API_TOKEN env vars into the Claude Agent SDK subprocess on every
 * query, and any Jira-aware skill or MCP the user drops into the
 * container can read them.
 *
 * Credentials file: ~/.claude/custom-jira/credentials.json (mode 0600)
 */
const CREDENTIALS_DIR = (0, path_1.join)((0, os_1.homedir)(), ".claude", "custom-jira");
const CREDENTIALS_FILE = (0, path_1.join)(CREDENTIALS_DIR, "credentials.json");
/** Normalise a domain to the bare host. Accepts full URLs or hostnames. */
function normaliseDomain(input) {
    const trimmed = input.trim().replace(/\/+$/, "");
    if (!trimmed)
        return "";
    try {
        const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
        return new URL(withScheme).host;
    }
    catch {
        return trimmed;
    }
}
async function saveCredentials(creds) {
    await (0, promises_1.mkdir)(CREDENTIALS_DIR, { recursive: true });
    await (0, promises_1.writeFile)(CREDENTIALS_FILE, JSON.stringify({ ...creds, domain: normaliseDomain(creds.domain) }, null, 2), "utf-8");
    try {
        await (0, promises_1.chmod)(CREDENTIALS_FILE, 0o600);
    }
    catch {
        /* non-POSIX */
    }
}
async function loadCredentials() {
    if (!(0, fs_1.existsSync)(CREDENTIALS_FILE))
        return null;
    try {
        const raw = await (0, promises_1.readFile)(CREDENTIALS_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (!parsed.domain || !parsed.email || !parsed.apiToken)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
/**
 * Sync variant used inside the query hot-path in server.ts. Re-read on
 * every query so rotated tokens / disconnects take effect without a
 * container restart.
 */
function loadCredentialsSync() {
    if (!(0, fs_1.existsSync)(CREDENTIALS_FILE))
        return null;
    try {
        const raw = (0, fs_1.readFileSync)(CREDENTIALS_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (!parsed.domain || !parsed.email || !parsed.apiToken)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
async function deleteCredentials() {
    if ((0, fs_1.existsSync)(CREDENTIALS_FILE)) {
        await (0, promises_1.unlink)(CREDENTIALS_FILE).catch(() => { });
    }
}
