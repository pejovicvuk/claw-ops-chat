"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.persistSession = persistSession;
exports.loadAllSessions = loadAllSessions;
exports.deleteSessionFile = deleteSessionFile;
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const os_1 = require("os");
/**
 * Disk persistence for chat sessions so a container restart doesn't wipe
 * every in-flight conversation. Writes one JSON file per session to
 * ~/.claude/chat-sessions/<id>.json; reads them all back on boot.
 *
 * Only the "replayable" slice of each session is persisted — the live
 * client set, pending request resolvers, rate-limit timestamps, and
 * the active AbortController all reset on restart. Everything a
 * reconnecting UI needs to reconstruct state (status, eventHistory,
 * claudeSessionId, permissionMode, resolved tool list) survives.
 */
const SESSIONS_DIR = (0, path_1.join)((0, os_1.homedir)(), ".claude", "chat-sessions");
async function ensureDir() {
    if (!(0, fs_1.existsSync)(SESSIONS_DIR)) {
        await (0, promises_1.mkdir)(SESSIONS_DIR, { recursive: true });
    }
}
function fileFor(id) {
    // Sanity-filter the id — reject anything that couldn't be a valid
    // filename. The server generates UUIDs or "new-<ts>" strings today;
    // both pass through this regex.
    if (!/^[\w.-]{1,128}$/.test(id)) {
        throw new Error(`invalid session id for persistence: ${id}`);
    }
    return (0, path_1.join)(SESSIONS_DIR, `${id}.json`);
}
async function persistSession(data) {
    await ensureDir();
    const path = fileFor(data.id);
    // Atomic-ish write: write to .tmp then rename. Avoids corrupt JSON
    // if the process dies mid-write.
    const tmp = `${path}.tmp`;
    await (0, promises_1.writeFile)(tmp, JSON.stringify(data), "utf-8");
    const { rename } = await Promise.resolve().then(() => __importStar(require("fs/promises")));
    await rename(tmp, path);
}
async function loadAllSessions() {
    if (!(0, fs_1.existsSync)(SESSIONS_DIR))
        return [];
    const out = [];
    try {
        const entries = await (0, promises_1.readdir)(SESSIONS_DIR);
        for (const name of entries) {
            if (!name.endsWith(".json"))
                continue;
            try {
                const raw = await (0, promises_1.readFile)((0, path_1.join)(SESSIONS_DIR, name), "utf-8");
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.id === "string") {
                    out.push(parsed);
                }
            }
            catch {
                // Skip corrupt / partial files — don't let one bad session take
                // the whole server down.
            }
        }
    }
    catch {
        // Directory read errors are non-fatal.
    }
    return out;
}
async function deleteSessionFile(id) {
    try {
        const path = fileFor(id);
        if ((0, fs_1.existsSync)(path))
            await (0, promises_1.unlink)(path);
    }
    catch {
        // Ignore — file may be gone already or the id was invalid.
    }
}
