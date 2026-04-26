"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVapidKeys = getVapidKeys;
exports.getVapidPublicKey = getVapidPublicKey;
const fs_1 = require("fs");
const path_1 = require("path");
const web_push_1 = __importDefault(require("web-push"));
const IS_PRODUCTION = process.env.NODE_ENV === "production";
function persistGeneratedKeys(keys) {
    if (IS_PRODUCTION)
        return;
    try {
        const envPath = (0, path_1.join)(process.cwd(), ".env.local");
        let existing = "";
        if ((0, fs_1.existsSync)(envPath))
            existing = (0, fs_1.readFileSync)(envPath, "utf-8");
        const lines = [];
        if (!/^VAPID_PUBLIC_KEY=/m.test(existing)) {
            lines.push(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
        }
        if (!/^VAPID_PRIVATE_KEY=/m.test(existing)) {
            lines.push(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
        }
        if (lines.length === 0)
            return;
        if ((0, fs_1.existsSync)(envPath)) {
            const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
            (0, fs_1.appendFileSync)(envPath, `${prefix}${lines.join("\n")}\n`);
        }
        else {
            (0, fs_1.writeFileSync)(envPath, `${lines.join("\n")}\n`);
        }
        console.log("[push] Generated VAPID keypair and persisted to .env.local");
    }
    catch (err) {
        console.warn("[push] Failed to persist VAPID keys:", err);
    }
}
let _cached = null;
function getVapidKeys() {
    if (_cached)
        return _cached;
    let publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || "";
    let privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
    if (!publicKey || !privateKey) {
        const generated = web_push_1.default.generateVAPIDKeys();
        publicKey = generated.publicKey;
        privateKey = generated.privateKey;
        persistGeneratedKeys(generated);
        process.env.VAPID_PUBLIC_KEY = publicKey;
        process.env.VAPID_PRIVATE_KEY = privateKey;
    }
    // Subject is required by Web Push spec — must be a mailto: or https:// URL
    // identifying the app operator. We use a sane default that the user can
    // override via env without re-generating keys.
    const subject = process.env.VAPID_SUBJECT?.trim() ||
        `mailto:${process.env.ALLOWED_EMAIL?.trim() || "admin@example.com"}`;
    _cached = { publicKey, privateKey, subject };
    web_push_1.default.setVapidDetails(subject, publicKey, privateKey);
    return _cached;
}
function getVapidPublicKey() {
    return getVapidKeys().publicKey;
}
