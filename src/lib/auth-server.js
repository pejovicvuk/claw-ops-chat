"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signSession = signSession;
exports.verifySession = verifySession;
exports.extractSession = extractSession;
exports.extractSessionFromCookieHeader = extractSessionFromCookieHeader;
exports.unauthorized = unauthorized;
exports.makeSessionCookie = makeSessionCookie;
exports.makeClearSessionCookie = makeClearSessionCookie;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const COOKIE_NAME = "claw-session";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds
/**
 * Persist a generated SESSION_SECRET to .env.local in development so the
 * next server restart doesn't invalidate every existing session cookie.
 * In production we keep the old generate-and-warn behavior to avoid
 * writing into container filesystems.
 */
function persistGeneratedSecret(value) {
    if (IS_PRODUCTION)
        return;
    try {
        const envPath = (0, path_1.join)(process.cwd(), ".env.local");
        if ((0, fs_1.existsSync)(envPath)) {
            const existing = (0, fs_1.readFileSync)(envPath, "utf-8");
            if (/^SESSION_SECRET=/m.test(existing))
                return;
            const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
            (0, fs_1.appendFileSync)(envPath, `${prefix}SESSION_SECRET=${value}\n`);
        }
        else {
            (0, fs_1.writeFileSync)(envPath, `SESSION_SECRET=${value}\n`);
        }
        console.log("[auth] Generated SESSION_SECRET and persisted to .env.local");
    }
    catch (err) {
        console.warn("[auth] Failed to persist SESSION_SECRET:", err);
    }
}
/** HMAC key for signing session cookies. Auto-generated if not provided. */
const SESSION_SECRET = process.env.SESSION_SECRET ||
    (() => {
        const key = (0, crypto_1.randomBytes)(32).toString("hex");
        persistGeneratedSecret(key);
        return key;
    })();
/**
 * Sign a session payload: base64(JSON) + "." + hmac_hex
 */
function signSession(email) {
    const payload = {
        email,
        exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
    };
    const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = (0, crypto_1.createHmac)("sha256", SESSION_SECRET).update(data).digest("hex");
    return `${data}.${sig}`;
}
/**
 * Verify a signed session cookie. Returns the payload or null.
 */
function verifySession(cookie) {
    const dotIdx = cookie.indexOf(".");
    if (dotIdx === -1)
        return null;
    const data = cookie.slice(0, dotIdx);
    const sig = cookie.slice(dotIdx + 1);
    // Verify HMAC
    const expected = (0, crypto_1.createHmac)("sha256", SESSION_SECRET).update(data).digest("hex");
    if (sig.length !== expected.length)
        return null;
    try {
        if (!(0, crypto_1.timingSafeEqual)(Buffer.from(sig), Buffer.from(expected)))
            return null;
    }
    catch {
        return null;
    }
    // Decode payload
    try {
        const payload = JSON.parse(Buffer.from(data, "base64url").toString());
        // Check expiry
        if (payload.exp < Math.floor(Date.now() / 1000))
            return null;
        return payload;
    }
    catch {
        return null;
    }
}
/* ------------------------------------------------------------------ */
/*  Token extraction from requests                                     */
/* ------------------------------------------------------------------ */
/**
 * Extract and verify session from a Next.js Request object.
 * Reads the httpOnly cookie.
 */
function extractSession(request) {
    const cookieHeader = request.headers.get("Cookie");
    if (!cookieHeader)
        return null;
    const cookieValue = parseCookieValue(cookieHeader, COOKIE_NAME);
    if (!cookieValue)
        return null;
    return verifySession(cookieValue);
}
/**
 * Extract and verify session from a raw HTTP cookie header string.
 * Used by server.ts for WebSocket upgrade requests.
 */
function extractSessionFromCookieHeader(cookieHeader) {
    if (!cookieHeader)
        return null;
    const cookieValue = parseCookieValue(cookieHeader, COOKIE_NAME);
    if (!cookieValue)
        return null;
    return verifySession(cookieValue);
}
/* ------------------------------------------------------------------ */
/*  Cookie helpers                                                     */
/* ------------------------------------------------------------------ */
function unauthorized() {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
    });
}
/** Create Set-Cookie header value for the signed session. */
function makeSessionCookie(signedValue) {
    const parts = [
        `${COOKIE_NAME}=${encodeURIComponent(signedValue)}`,
        "HttpOnly",
        "SameSite=Strict",
        "Path=/chat",
        `Max-Age=${SESSION_MAX_AGE}`,
    ];
    if (IS_PRODUCTION) {
        parts.push("Secure");
    }
    return parts.join("; ");
}
/** Create Set-Cookie header value that clears the session cookie. */
function makeClearSessionCookie() {
    return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/chat; Max-Age=0`;
}
function parseCookieValue(header, name) {
    const prefix = `${name}=`;
    for (const part of header.split(";")) {
        const trimmed = part.trim();
        if (trimmed.startsWith(prefix)) {
            return decodeURIComponent(trimmed.slice(prefix.length));
        }
    }
    return null;
}
