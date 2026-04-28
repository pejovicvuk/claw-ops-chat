import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import webPush from "web-push";
import { getPushStore } from "./store";
import { getVapidStore } from "./vapid-store";

/**
 * VAPID keypair management.
 *
 * Resolution order:
 *   1. `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` env (operator override).
 *      Also written through to the persistent file so a later env-less
 *      start still recovers the same pair.
 *   2. `/root/.config/vapid-keys.json` via `vapid-store` (survives
 *      container restarts via the bind-mounted /root volume).
 *   3. Generate fresh, persist to the file, and **clear all existing
 *      push subscriptions** — those were issued against a now-lost
 *      keypair and every send would 401/403 from the upstream push
 *      service ("Received unexpected response code"). The user must
 *      re-enable on each device after this branch fires.
 *
 * Previously this function only checked env and held generated keys in
 * `process.env`, so every container restart silently broke push
 * delivery for every device. The file backing makes the keypair
 * lifetime independent of the process lifetime.
 *
 * `getVapidKeys()` is now async (it has to read/write the file). All
 * callers are already in async contexts.
 */

interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Best-effort write to `.env.local` so a `npm run dev` user sees the
 * generated keys in their env file (matches the SESSION_SECRET pattern
 * in `auth-server.ts`). Production loads from the file store, not
 * `.env.local`, so this is a dev-only convenience.
 */
function persistGeneratedKeysToEnvFile(keys: { publicKey: string; privateKey: string }): void {
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

let _cachedPromise: Promise<VapidKeys> | null = null;

export function getVapidKeys(): Promise<VapidKeys> {
  if (!_cachedPromise) _cachedPromise = init();
  return _cachedPromise;
}

async function init(): Promise<VapidKeys> {
  let publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || "";
  let privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
  let source: "env" | "file" | "generated" = "env";

  if (!publicKey || !privateKey) {
    const stored = await getVapidStore().load();
    if (stored) {
      publicKey = stored.publicKey;
      privateKey = stored.privateKey;
      source = "file";
    }
  }

  if (!publicKey || !privateKey) {
    const generated = webPush.generateVAPIDKeys();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
    source = "generated";
    try {
      await getVapidStore().save(generated);
    } catch (err) {
      console.warn("[push] failed to persist generated VAPID keys:", err);
    }
    persistGeneratedKeysToEnvFile(generated);
    // Existing subscriptions reference an unrecoverable old keypair.
    // Drop them so users re-enable and bind the new public key. No-op
    // when the file is empty (first-ever start).
    try {
      const dropped = await getPushStore().clearAllAcrossUsers();
      if (dropped > 0) {
        console.warn(
          `[push] Generated fresh VAPID keypair; cleared ${dropped} stale subscription(s). Users must re-enable notifications on each device.`,
        );
      }
    } catch (err) {
      console.warn("[push] failed to clear stale subscriptions on key generation:", err);
    }
  } else if (source === "env") {
    // Defense-in-depth: when env supplies the keys, mirror them into the
    // file so a future env-less start (a deploy without the var) still
    // recovers the same keypair instead of silently regenerating.
    try {
      const stored = await getVapidStore().load();
      if (!stored || stored.publicKey !== publicKey) {
        await getVapidStore().save({ publicKey, privateKey });
      }
    } catch (err) {
      console.warn("[push] failed to mirror env VAPID keys to file:", err);
    }
  }

  process.env.VAPID_PUBLIC_KEY = publicKey;
  process.env.VAPID_PRIVATE_KEY = privateKey;

  const subject =
    process.env.VAPID_SUBJECT?.trim() ||
    `mailto:${process.env.ALLOWED_EMAIL?.trim() || "admin@example.com"}`;

  webPush.setVapidDetails(subject, publicKey, privateKey);
  console.log(`[push] VAPID keys initialised (source=${source})`);

  return { publicKey, privateKey, subject };
}

export async function getVapidPublicKey(): Promise<string> {
  const keys = await getVapidKeys();
  return keys.publicKey;
}
