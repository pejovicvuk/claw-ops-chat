import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import webPush from "web-push";

/**
 * VAPID keypair management. Read priority:
 *   1. VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars (explicit provision).
 *   2. /root/.config/vapid-keys.json — persisted from a previous run.
 *      This file lives in the Docker bind-mount (/root:/root) so it
 *      survives container restarts without requiring manual env provisioning.
 *   3. Generate fresh, save to both the config file and (dev only) .env.local.
 *
 * IMPORTANT: VAPID keys must never change once clients have subscribed with
 * them. A key rotation invalidates every push subscription in the store and
 * silently kills all future notifications until users re-register. The
 * config-file fallback eliminates the previous production bug where keys were
 * regenerated (in-memory only) on every restart.
 */

interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const KEYS_FILE = "/root/.config/vapid-keys.json";

function loadPersistedVapidKeys(): { publicKey: string; privateKey: string } | null {
  try {
    if (!existsSync(KEYS_FILE)) return null;
    const parsed = JSON.parse(readFileSync(KEYS_FILE, "utf-8")) as Record<string, unknown>;
    const pub = typeof parsed.publicKey === "string" ? parsed.publicKey.trim() : "";
    const priv = typeof parsed.privateKey === "string" ? parsed.privateKey.trim() : "";
    if (pub && priv) return { publicKey: pub, privateKey: priv };
  } catch {
    /* ignore corrupt file — will regenerate */
  }
  return null;
}

function saveVapidKeys(keys: { publicKey: string; privateKey: string }): void {
  try {
    mkdirSync(dirname(KEYS_FILE), { recursive: true });
    writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), "utf-8");
  } catch (err) {
    console.warn("[push] Failed to persist VAPID keys to config file:", err);
  }
}

function persistToEnvLocal(keys: { publicKey: string; privateKey: string }): void {
  if (IS_PRODUCTION) return;
  try {
    const envPath = join(process.cwd(), ".env.local");
    let existing = "";
    if (existsSync(envPath)) existing = readFileSync(envPath, "utf-8");
    const lines: string[] = [];
    if (!/^VAPID_PUBLIC_KEY=/m.test(existing)) lines.push(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
    if (!/^VAPID_PRIVATE_KEY=/m.test(existing)) lines.push(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
    if (lines.length === 0) return;
    if (existsSync(envPath)) {
      const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
      appendFileSync(envPath, `${prefix}${lines.join("\n")}\n`);
    } else {
      writeFileSync(envPath, `${lines.join("\n")}\n`);
    }
  } catch (err) {
    console.warn("[push] Failed to persist VAPID keys to .env.local:", err);
  }
}

let _cached: VapidKeys | null = null;

export function getVapidKeys(): VapidKeys {
  if (_cached) return _cached;

  let publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || "";
  let privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";

  if (!publicKey || !privateKey) {
    // Try the config-file fallback before generating new keys.
    const persisted = loadPersistedVapidKeys();
    if (persisted) {
      publicKey = persisted.publicKey;
      privateKey = persisted.privateKey;
      console.log("[push] Loaded VAPID keys from", KEYS_FILE);
    } else {
      const generated = webPush.generateVAPIDKeys();
      publicKey = generated.publicKey;
      privateKey = generated.privateKey;
      saveVapidKeys(generated);
      persistToEnvLocal(generated);
      console.log("[push] Generated new VAPID keypair and persisted to", KEYS_FILE);
    }
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
