import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import webPush from "web-push";

/**
 * VAPID keypair management. Mirrors the SESSION_SECRET pattern in
 * `auth-server.ts`: read from env if present, otherwise generate fresh
 * and persist to `.env.local` (dev only — production is expected to
 * provision the keys via the container env).
 *
 * The public key is shipped to clients (via /api/push/vapid-key) so
 * they can call `pushManager.subscribe({ applicationServerKey })`. The
 * private key never leaves the server.
 */

interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function persistGeneratedKeys(keys: { publicKey: string; privateKey: string }): void {
  if (IS_PRODUCTION) return;
  try {
    const envPath = join(process.cwd(), ".env.local");
    let existing = "";
    if (existsSync(envPath)) existing = readFileSync(envPath, "utf-8");
    const lines: string[] = [];
    if (!/^VAPID_PUBLIC_KEY=/m.test(existing)) {
      lines.push(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
    }
    if (!/^VAPID_PRIVATE_KEY=/m.test(existing)) {
      lines.push(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
    }
    if (lines.length === 0) return;
    if (existsSync(envPath)) {
      const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
      appendFileSync(envPath, `${prefix}${lines.join("\n")}\n`);
    } else {
      writeFileSync(envPath, `${lines.join("\n")}\n`);
    }
    console.log("[push] Generated VAPID keypair and persisted to .env.local");
  } catch (err) {
    console.warn("[push] Failed to persist VAPID keys:", err);
  }
}

let _cached: VapidKeys | null = null;

export function getVapidKeys(): VapidKeys {
  if (_cached) return _cached;
  let publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || "";
  let privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
  if (!publicKey || !privateKey) {
    const generated = webPush.generateVAPIDKeys();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
    persistGeneratedKeys(generated);
    process.env.VAPID_PUBLIC_KEY = publicKey;
    process.env.VAPID_PRIVATE_KEY = privateKey;
  }
  // Subject is required by Web Push spec — must be a mailto: or https:// URL
  // identifying the app operator. We use a sane default that the user can
  // override via env without re-generating keys.
  const subject =
    process.env.VAPID_SUBJECT?.trim() ||
    `mailto:${process.env.ALLOWED_EMAIL?.trim() || "admin@example.com"}`;
  _cached = { publicKey, privateKey, subject };
  webPush.setVapidDetails(subject, publicKey, privateKey);
  return _cached;
}

export function getVapidPublicKey(): string {
  return getVapidKeys().publicKey;
}
