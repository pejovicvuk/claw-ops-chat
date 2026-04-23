"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveCredentials = saveCredentials;
exports.loadCredentials = loadCredentials;
exports.loadCredentialsSync = loadCredentialsSync;
exports.deleteCredentials = deleteCredentials;
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const os_1 = require("os");
/**
 * Stores Trello API credentials (key + token pair — that's what Trello's
 * REST API uses, no OAuth in this flow). Mirrors the Bitbucket / Jira
 * pattern: no MCP server registered here because there's no canonical
 * Trello MCP package on npm; instead server.ts injects TRELLO_API_KEY /
 * TRELLO_TOKEN env vars into the Claude Agent SDK subprocess on every
 * query, and any Trello-aware skill or MCP the user drops in can read
 * them.
 *
 * Credentials file: ~/.claude/custom-trello/credentials.json (mode 0600)
 */
const CREDENTIALS_DIR = (0, path_1.join)((0, os_1.homedir)(), ".claude", "custom-trello");
const CREDENTIALS_FILE = (0, path_1.join)(CREDENTIALS_DIR, "credentials.json");
async function saveCredentials(creds) {
    await (0, promises_1.mkdir)(CREDENTIALS_DIR, { recursive: true });
    await (0, promises_1.writeFile)(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), "utf-8");
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
        if (!parsed.apiKey || !parsed.apiToken)
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
        if (!parsed.apiKey || !parsed.apiToken)
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
